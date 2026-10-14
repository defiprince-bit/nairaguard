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
  readState: async () => live, siwe: { domain: DOMAIN, uri: `https://${DOMAIN}`, chainId: 42220, client: client as never },
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

describe('Task 8a follow-ups', () => {
  it('P&L is null (not 0.00) before a baseline exists', async () => {
    await db.query(`INSERT INTO quotes (vault, rate, ngn_balance, usd_balance, value_ngn, hold_value_ngn, pnl_ngn)
      VALUES ($1,'1500','0','0','0','0','0')`, [VAULT.toLowerCase()]);
    live = state(0, 0);
    const r = await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/balances` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pnlNgn: null, pnlUsd: null, pnlSince: null, lastCheckedAt: null });
  });

  it('approvals with no quote return rate null and "rate unavailable", never rate 1', async () => {
    await db.query(`INSERT INTO approvals (vault, onchain_id, token_in, token_out, amount_in, min_out, usd_value, reason, expires_at)
      VALUES ($1,'7',$2,$3,$4,'1','1','big','2026-10-15T00:00:00Z')`, [VAULT, CNGN, USDT, e18(90_000).toString()]);
    const item = ((await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/approvals` })).body as any).items[0];
    expect(item.rateNgnPerUsd).toBeNull();
    expect(item).not.toHaveProperty('rate');
    expect(item.rateNote).toBe('rate unavailable');
    expect(item.in).toMatchObject({ token: 'cNGN', amountNgn: null, amountUsd: null, rate: null });
  });

  it('volume uses actual amounts, and lastCheckedAt is per vault', async () => {
    const other = '0x00000000000000000000000000000000000000aa';
    await logQuote(db, VAULT, e18(300_000), e18(100), 1500, clock);
    await db.query(`INSERT INTO activity (vault, kind, token_in, token_out, amount_in, min_out, amount_out, reason, status)
      VALUES ($1,'swap',$2,$3,$4,$5,$6,'r','confirmed'), ($1,'swap',$3,$2,$7,'1',$8,'r','confirmed')`,
      [VAULT, CNGN, USDT, e18(75_000).toString(), e18(40).toString(), e18(49.9).toString(), e18(10).toString(), e18(14_900).toString()]);
    await db.query(`INSERT INTO agent_runs (vault, ok, ran_at) VALUES ($1,true,'2026-10-14T11:55:00Z'), ($2,true,'2026-10-14T11:59:00Z')`,
      [VAULT.toLowerCase(), other]);
    const b = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/balances` })).body as any;
    expect(b.volumeUsd).toBe('59.90'); // 49.9 received + 10 sent, not minOut 40
    expect(b.lastCheckedAt).toBe('2026-10-14T11:55:00.000Z');
    const st = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/status` })).body as any;
    expect(st).toMatchObject({ lastCheckedAt: '2026-10-14T11:55:00.000Z', ok: true });
  });
});

describe('reject + paging', () => {
  it('approvals and activity report status "rejected"', async () => {
    await db.query(`INSERT INTO approvals (vault, onchain_id, token_in, token_out, amount_in, min_out, usd_value, reason, tx_hash, expires_at)
      VALUES ($1,'5',$2,$3,'1','1','1','big','0xp5','2026-10-15T00:00:00Z')`, [VAULT, CNGN, USDT]);
    await db.query(`INSERT INTO activity (vault, kind, token_in, token_out, amount_in, min_out, rate, reason, tx_hash, status)
      VALUES ($1,'propose',$2,$3,'1','1','1500','big','0xp5','confirmed')`, [VAULT, CNGN, USDT]);
    const { markRejected } = await import('./db.js');
    await markRejected(db, VAULT, '5', '0xr5', clock);
    const ap = ((await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/approvals` })).body as any).items;
    expect(ap[0]).toMatchObject({ id: '5', status: 'rejected', rejectedAt: clock.toISOString() });
    const act = ((await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity` })).body as any).items;
    expect(act[0]).toMatchObject({ kind: 'swap', status: 'rejected', txHash: '0xp5' });
  });

  it('pages /activity by (createdAt, id) with nextCursor null on the last page', async () => {
    // 5 rows; two share a created_at to exercise the id tiebreak.
    const ts = ['2026-10-14T10:00:00Z', '2026-10-14T11:00:00Z', '2026-10-14T11:00:00Z', '2026-10-14T11:30:00.123456Z', '2026-10-14T12:00:00Z'];
    for (const t of ts) {
      await db.query(`INSERT INTO activity (vault, kind, reason, status, created_at) VALUES ($1,'swap','r','confirmed',$2)`, [VAULT, t]);
    }
    await db.query(`INSERT INTO activity (vault, kind, reason, status) VALUES ($1,'noop','skip','skipped')`, [VAULT]);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `/api/vault/${VAULT}/activity?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const body = (await api().handle({ method: 'GET', url })).body as { items: { id: string }[]; nextCursor: string | null };
      seen.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(cursor).toBeNull();
    expect(seen).toEqual(['5', '4', '3', '2', '1']);
    const bad = await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity?cursor=nope` });
    expect(bad.status).toBe(400);
  });
});

describe('read endpoints', () => {
  it('limits, activity, approvals, agent', async () => {
    const a = api();
    expect((await a.handle({ method: 'GET', url: `/api/vault/${VAULT}/limits` })).body).toMatchObject({ targetNgnBps: 5000, maxSlippageBps: 100 });
    await db.query(`INSERT INTO activity (vault, kind, token_in, token_out, amount_in, min_out, amount_out, rate, reason, tx_hash, status)
      VALUES ($1,'swap',$2,$3,$4,$5,$6,'1500','rebalance','0xab','confirmed')`,
      [VAULT, CNGN, USDT, e18(75_000).toString(), e18(49.5).toString(), e18(49.9).toString()]);
    const act = (await a.handle({ method: 'GET', url: `/api/vault/${VAULT}/activity` })).body as { items: any[] };
    // `out` is the actual amount received (49.9), not minOut (49.5).
    expect(act.items[0]).toMatchObject({ kind: 'swap', in: { token: 'cNGN', amountUsd: '50.00' }, out: { token: 'USDT', amountUsd: '49.90' }, amountOut: e18(49.9).toString() });
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
      address: acc.address, chainId: 42220, domain, uri: `https://${domain}`, version: '1', nonce,
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

  it('accepts a Celo mainnet (42220) message and rejects a Sepolia-signed one', async () => {
    const a = api();
    const t = await join(a);
    const { nonce, message } = (await a.handle({ method: 'GET', url: `/api/waitlist/nonce?address=${acc.address}` })).body as { nonce: string; message: string };
    expect(message).toContain('Chain ID: 42220');
    const sepolia = createSiweMessage({
      address: acc.address, chainId: 11142220, domain: DOMAIN, uri: `https://${DOMAIN}`, version: '1', nonce,
      issuedAt: clock, expirationTime: new Date(clock.getTime() + 60_000),
    });
    const post = async (m: string) => a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: t, message: m, signature: await acc.signMessage({ message: m }) } });
    expect(await post(sepolia)).toMatchObject({ status: 401, body: { error: 'siwe_wrong_chain' } });
    expect(await post(message)).toMatchObject({ status: 200, body: { verified: true } });
  });

  it('logs waitlist requests as JSON with address only (no contact)', async () => {
    const a = api();
    const lines: string[] = [];
    const orig = console.log;
    console.log = (m: string) => { lines.push(m); };
    try {
      const t = await join(a, { ...base, wallet: acc.address });
      await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: { signupToken: t, ...(await signed(a)) } });
      await a.handle({ method: 'POST', url: '/api/waitlist/verify', body: {} });
    } finally { console.log = orig; }
    const evts = lines.map((l) => JSON.parse(l));
    expect(evts.map((e) => [e.path, e.status])).toEqual([['/api/waitlist', 200], ['/api/waitlist/nonce', 200], ['/api/waitlist/verify', 200], ['/api/waitlist/verify', 400]]);
    expect(evts[2].address).toBe(acc.address.toLowerCase());
    expect(evts[3].error).toBe('signup_token_required');
    expect(lines.join('')).not.toContain('ada@example.com');
  });

  it('normalises sources', () => {
    expect(normaliseSource('minipay')).toBe('minipay');
    expect(normaliseSource(undefined)).toBe('direct');
  });
});
