import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPublicClient, custom, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { createApi, hashToken, normaliseSource } from './api.js';
import { type Db, migrate } from './db.js';
import type { VaultState } from './loop.js';
import { computePnl, logQuote } from './pnl.js';

const VAULT = '0xD436aA344C0E2a58a607443680651a2c32066be6' as const;
const v = VAULT.toLowerCase();
const CNGN = '0xaA3B7364E418deC4Fb147f1BD2d95A4022082aEA' as const;
const USDT = '0xe123971ec3F56138766272B7b15Ee188fdD0eFf7' as const;
const e18 = (n: number) => parseUnits(String(n), 18);
const DOMAIN = 'nairaguard-vert.vercel.app';
// No RPC in tests: EOA signatures verify locally after contract-wallet checks fail.
const client = createPublicClient({ transport: custom({ request: async () => { throw new Error('offline'); } }) });

let db: Db;
let clock: Date;
const state = (ngn: number, usd: number): VaultState => ({
  ngnBalance: e18(ngn), usdBalance: e18(usd), dailySpentUsd: 0n, dayStart: 0n, paused: false,
  limits: { maxTradeUsd: e18(100), maxDailyUsd: e18(500), approvalThresholdUsd: e18(100), maxSlippageBps: 100, targetNgnBps: 5000 },
});
let live = state(300_000, 100);
const api = () => createApi({
  db, agentAddress: '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4', tokens: { cngn: CNGN, usdt: USDT },
  readState: async () => live, siwe: { domain: DOMAIN, uri: `https://${DOMAIN}`, chainId: 11142220, client: client as never },
  now: () => clock,
});

beforeEach(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  clock = new Date('2026-10-14T12:00:00Z');
  live = state(300_000, 100);
});

describe('P&L', () => {
  it('is zero with no trading and no rate move, and tracks naira weakening', () => {
    const b = { ngnStart: e18(300_000).toString(), usdStart: e18(100).toString(), rateStart: '1500', fundedAt: clock };
    expect(computePnl(b, e18(300_000), e18(100), 1500).pnlNgn).toBeCloseTo(0);
    // Swapped ₦75,000 → $50 at 1500, then naira weakens to 1600: saved 50 * 100 = ₦5,000.
    const p = computePnl(b, e18(225_000), e18(150), 1600);
    expect(p.pnlNgn).toBeCloseTo(5_000);
    expect(p.pnlUsd).toBeCloseTo(5_000 / 1600);
  });

  it('balances endpoint returns pnlNgn, pnlUsd, pnlSince from logged quotes', async () => {
    await logQuote(db, VAULT, e18(300_000), e18(100), 1500, new Date('2026-10-10T00:00:00Z'));
    await logQuote(db, VAULT, e18(225_000), e18(150), 1600, clock);
    live = state(225_000, 150);
    const r = await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/balances` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pnlNgn: '5000.00', pnlUsd: '3.13', pnlSince: '2026-10-10T00:00:00.000Z', targetNgnBps: 5000 });
    const { rows } = await db.query('SELECT * FROM quotes');
    expect(rows).toHaveLength(2);
  });
});

describe('read endpoints', () => {
  it('limits, activity, approvals, agent', async () => {
    const a = api();
    expect((await a.handle({ method: 'GET', url: `/api/vault/${VAULT}/limits` })).body).toMatchObject({ targetNgnBps: 5000, maxSlippageBps: 100 });
    await db.query(`INSERT INTO activity (vault, kind, token_in, token_out, amount_in, min_out, rate, reason, tx_hash, status)
      VALUES ($1,'swap',$2,$3,$4,$5,'1500','rebalance','0xab','confirmed')`, [VAULT, CNGN, USDT, e18(75_000).toString(), e18(49.5).toString()]);
    const act = (await a.handle({ method: 'GET', url: `/api/vault/${VAULT}/activity` })).body as { items: any[] };
    expect(act.items[0]).toMatchObject({ kind: 'swap', in: { token: 'cNGN', amountUsd: '50.00' }, out: { token: 'USDT' } });
    await db.query(`INSERT INTO approvals (vault, onchain_id, token_in, token_out, amount_in, min_out, usd_value, reason, expires_at)
      VALUES ($1,'1',$2,$3,'1','1','1','big','2026-10-15T00:00:00Z')`, [VAULT, CNGN, USDT]);
    expect(((await a.handle({ method: 'GET', url: `/api/vault/${v}/approvals` })).body as any).items).toHaveLength(1);
    await db.query(`INSERT INTO agent_runs (vault, ok, ran_at) VALUES ($1, true, $2)`, [VAULT, '2026-10-14T11:58:00Z']);
    expect((await a.handle({ method: 'GET', url: '/api/agent' })).body).toMatchObject({ healthy: true });
    expect((await a.handle({ method: 'GET', url: '/nope' })).status).toBe(404);
  });
});

describe('waitlist (SIWE)', () => {
  const acc = privateKeyToAccount(generatePrivateKey());
  async function signed(a: ReturnType<typeof api>) {
    const r = await a.handle({ method: 'GET', url: `/api/waitlist/nonce?address=${acc.address}` });
    const { message } = r.body as { message: string };
    return { message, signature: await acc.signMessage({ message }) };
  }
  const base = { contact: 'ada@example.com', consent: true };

  async function join(a: ReturnType<typeof api>, body: object = base, url = '/api/waitlist') {
    const r = await a.handle({ method: 'POST', url, body });
    return (r.body as { signupToken: string }).signupToken;
  }

  it('joins unverified (source from ?source=, client verified flag ignored), then SIWE verifies', async () => {
    const a = api();
    const r = await a.handle({ method: 'POST', url: '/api/waitlist?source=celo-ng', body: { ...base, verified: true, fromMiniPay: true } });
    expect(r).toMatchObject({ status: 200, body: { ok: true, verified: false } });
    const id = (r.body as { signupToken: string }).signupToken;
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    await join(a, { contact: '+2348012345678', consent: true }, '/api/waitlist?source=evil');
    let { rows } = await db.query<any>('SELECT * FROM waitlist ORDER BY id');
    expect(rows[0]).toMatchObject({ verified: false, source: 'celo-ng', from_minipay: true });
    expect(rows[1]).toMatchObject({ verified: false, source: 'direct' });

    const v = await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: id, ...(await signed(a)) } });
    expect(v).toMatchObject({ status: 200, body: { ok: true, verified: true } });
    ({ rows } = await db.query<any>('SELECT * FROM waitlist ORDER BY id'));
    expect(rows[0]).toMatchObject({ verified: true, wallet_address: acc.address.toLowerCase() });
  });

  it('rejects a replayed nonce', async () => {
    const a = api();
    const id = await join(a);
    const s = await signed(a);
    expect((await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: id, ...s } })).status).toBe(200);
    const id2 = await join(a, { ...base, contact: 'b@example.com' });
    const again = await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: id2, ...s } });
    expect(again).toMatchObject({ status: 401, body: { error: 'siwe_nonce_invalid' } });
  });

  it('rejects an expired message', async () => {
    const a = api();
    const id = await join(a);
    const s = await signed(a);
    clock = new Date(clock.getTime() + 11 * 60_000);
    const r = await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: id, ...s } });
    expect(r).toMatchObject({ status: 401, body: { error: 'siwe_expired' } });
    const { rows } = await db.query<any>('SELECT verified FROM waitlist');
    expect(rows[0].verified).toBe(false);
  });

  it('rejects an unissued nonce, wrong domain, and wrong signer', async () => {
    const a = api();
    const id = await join(a);
    const mk = (domain: string, nonce: string) => createSiweMessage({
      address: acc.address, chainId: 11142220, domain, uri: `https://${domain}`, version: '1', nonce,
      issuedAt: clock, expirationTime: new Date(clock.getTime() + 60_000),
    });
    const post = async (message: string, signer = acc) =>
      (await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: id, message, signature: await signer.signMessage({ message }) } })).body;
    expect(await post(mk(DOMAIN, 'deadbeefdeadbeef'))).toMatchObject({ error: 'siwe_nonce_invalid' });
    const { nonce } = (await a.handle({ method: 'GET', url: '/api/waitlist/nonce' })).body as { nonce: string };
    expect(await post(mk('evil.example', nonce))).toMatchObject({ error: 'siwe_bad_signature' });
    expect(await post(mk(DOMAIN, nonce), privateKeyToAccount(generatePrivateKey()))).toMatchObject({ error: 'siwe_bad_signature' });
  });

  it('stores only the sha256 of the signup token', async () => {
    const a = api();
    const t = await join(a);
    const { rows } = await db.query<any>('SELECT * FROM waitlist');
    expect(rows[0].signup_token_hash).toBe(hashToken(t));
    expect(JSON.stringify(rows[0])).not.toContain(t);
  });

  it('rejects a missing or wrong signup token and does not burn the nonce', async () => {
    const a = api();
    const good = await join(a);
    const s = await signed(a);
    const post = (body: object) => a.handle({ method: 'POST', url: '/api/waitlist/verify', body });
    expect(await post({ ...s })).toMatchObject({ status: 400, body: { error: 'signup_token_required' } });
    expect(await post({ id: '1', ...s })).toMatchObject({ status: 400, body: { error: 'signup_token_required' } });
    expect(await post({ signupToken: 'ab'.repeat(32), ...s })).toMatchObject({ status: 404, body: { error: 'signup_not_found' } });
    const { rows } = await db.query<any>('SELECT verified FROM waitlist');
    expect(rows[0].verified).toBe(false);
    expect(await post({ signupToken: good, ...s })).toMatchObject({ status: 200 });
  });

  it("cannot overwrite another signup's wallet address", async () => {
    const a = api();
    const victim = privateKeyToAccount(generatePrivateKey()).address;
    const t = await join(a, { ...base, wallet: victim });
    const r = await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: t, ...(await signed(a)) } });
    expect(r).toMatchObject({ status: 409, body: { error: 'wallet_mismatch' } });
    const { rows } = await db.query<any>('SELECT * FROM waitlist');
    expect(rows[0]).toMatchObject({ wallet_address: victim.toLowerCase(), verified: false });
  });

  it('verifies when the stored wallet matches the signer (case-insensitive)', async () => {
    const a = api();
    const t = await join(a, { ...base, wallet: acc.address });
    const r = await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: t, ...(await signed(a)) } });
    expect(r).toMatchObject({ status: 200, body: { verified: true } });
  });

  it('normalises sources', () => {
    expect(normaliseSource('minipay')).toBe('minipay');
    expect(normaliseSource(undefined)).toBe('direct');
  });
});
