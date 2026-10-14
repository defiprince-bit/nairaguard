import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPublicClient, custom, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { createApi, fillRate, hashToken, normaliseSource } from './api.js';
import { type Db, insertRfqQuote, markApproved, markExecuted, migrate, type RfqOutcome } from './db.js';
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
  ngnBalance: e18(ngn), usdBalance: e18(usd), ngnDecimals: 18, usdDecimals: 18, dailySpentUsd: 0n, dayStart: 0n, paused: false,
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

describe('Task 8b API', () => {
  const insertApproval = (id: string, status = 'pending', extra = '') =>
    db.query(`INSERT INTO approvals (vault, onchain_id, token_in, token_out, amount_in, min_out, usd_value, reason, expires_at, status ${extra ? ', approved_at, window_expires_at' : ''})
      VALUES ($1,$2,$3,$4,'30000000','40500000000','30','r','2026-10-15T12:00:00Z',$5 ${extra})`, [v, id, USDT, CNGN, status]);

  it('approvals expose approvedMinOut and expiresAt (proposal deadline, then the 30-min window)', async () => {
    await insertApproval('1');
    await insertApproval('2', 'approved', `, '2026-10-14T11:50:00Z', '2026-10-14T12:20:00Z'`);
    const items = ((await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/approvals` })).body as any).items;
    const byId = Object.fromEntries(items.map((i: any) => [i.id, i]));
    expect(byId['1']).toMatchObject({ status: 'pending', approvedMinOut: '40500000000', expiresAt: '2026-10-15T12:00:00.000Z' });
    expect(byId['2']).toMatchObject({
      status: 'approved', approvedMinOut: '40500000000', expiresAt: '2026-10-14T12:20:00.000Z', approvedAt: '2026-10-14T11:50:00.000Z',
    });
    clock = new Date('2026-10-14T12:21:00Z');
    const later = ((await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/approvals` })).body as any).items;
    expect(later.find((i: any) => i.id === '2').status).toBe('expired');
  });

  const withFeed = (stale: boolean) => createApi({
    db, agentAddress: '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4', tokens: { cngn: CNGN, usdt: USDT },
    readState: async () => live, now: () => clock,
    readFeed: async () => ({ rateNgnPerUsd: 1329.91, answer: 75193n, decimals: 8, updatedAt: new Date('2026-10-14T11:58:00Z'), stale }),
    siwe: { domain: DOMAIN, uri: `https://${DOMAIN}`, chainId: 42220, client: client as never },
  });

  it('/status has feedRate and feedUpdatedAt, and paused "stale_price" when the feed is too old', async () => {
    const ok = (await withFeed(false).handle({ method: 'GET', url: `/api/vault/${VAULT}/status` })).body as any;
    expect(ok).toMatchObject({ feedRate: '1329.91', feedUpdatedAt: '2026-10-14T11:58:00.000Z', paused: null });
    const stale = (await withFeed(true).handle({ method: 'GET', url: `/api/vault/${VAULT}/status` })).body as any;
    expect(stale.paused).toBe('stale_price');
    live = { ...live, paused: true };
    expect(((await withFeed(false).handle({ method: 'GET', url: `/api/vault/${VAULT}/status` })).body as any).paused).toBe('owner');
  });

  it('activity exposes venue from the stored on-chain label, never for non-swaps', async () => {
    await logQuote(db, VAULT, e18(300_000), e18(100), 1500, clock);
    await db.query(`INSERT INTO activity (vault, kind, token_in, token_out, amount_in, amount_out, rate, reason, status, venue, venue_target)
      VALUES ($1,'swap',$2,$3,'1','1','1500','r','confirmed','textile','0xa9aa0a64769cbed4d3b1ceb4df01cde915c235b3'),
             ($1,'swap',$2,$3,'1','1','1500','r','confirmed','ubeswap-cngn-usdt','0xd3c'),
             ($1,'swap',$2,$3,'1','1','1500','legacy','confirmed',NULL,NULL)`, [v, CNGN, USDT]);
    const items = ((await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity` })).body as any).items;
    expect(items.map((i: any) => i.venue).sort()).toEqual(['textile', 'ubeswap-cngn-usdt', null].sort());
  });

  it('/api/quotes/stats counts every RFQ requested, quoted and filled, with the feed gap', async () => {
    const ins = (quoted: boolean, outcome: string, size: number, rate: number | null, at: string) =>
      db.query(`INSERT INTO textile_quotes (vault, side, token_in, token_out, sell_amount, size_usd, quoted, rate_ngn_per_usd,
        feed_rate_ngn_per_usd, outcome, requested_at) VALUES ($1,'ngnToUsd',$2,$3,'1',$4,$5,$6,1330,$7,$8)`,
        [v, CNGN, USDT, size, quoted, rate, outcome, at]);
    await ins(true, 'filled', 50, 1361, '2026-10-14T10:00:00Z');
    await ins(true, 'price_moved', 30, 1340, '2026-10-14T10:05:00Z');
    await ins(false, 'no_quote', 20, null, '2026-10-14T10:10:00Z');
    await ins(true, 'expired', 10, 1361, '2026-10-07T10:00:00Z');
    const r = (await api().handle({ method: 'GET', url: '/api/quotes/stats' })).body as any;
    expect(r).toMatchObject({ requested: 4, quoted: 3, filled: 1, requestedUsd: '110.00', quotedUsd: '90.00', filledUsd: '50.00' });
    expect(r.outcomes).toEqual({ filled: 1, expired: 1, declined: 0, no_quote: 1, price_moved: 1 });
    expect(r.avgGapBps).toBeGreaterThan(150);
    expect(r.weekly).toHaveLength(2);
    const since = (await api().handle({ method: 'GET', url: '/api/quotes/stats?since=2026-10-13T00:00:00Z' })).body as any;
    expect(since.requested).toBe(3);
    expect((await api().handle({ method: 'GET', url: '/api/quotes/stats?since=nope' })).status).toBe(400);
  });
});

describe('activity outcomes + executed fills', () => {
  const t = (min: number) => new Date(Date.parse('2026-10-14T10:00:00Z') + min * 60_000);
  const check = (min: number, outcome: RfqOutcome, approvalId?: string) => insertRfqQuote(db, {
    vault: VAULT, venue: 'textile', side: 'ngnToUsd', tokenIn: CNGN, tokenOut: USDT, sellAmount: '1', quoted: outcome !== 'no_quote',
    outcome, outcomeReason: outcome, approvalId, requestedAt: t(min),
  });
  const trade = (min: number) => db.query(
    `INSERT INTO activity (vault, kind, reason, status, created_at) VALUES ($1,'swap','r','confirmed',$2)`, [VAULT, t(min).toISOString()]);
  const all = async (limit: number) => {
    const out: any[] = []; let cursor: string | null = null;
    do {
      const body: any = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}` })).body;
      out.push(...body.items); cursor = body.nextCursor;
    } while (cursor);
    return out;
  };

  it('merges no-trade checks with trades, collapses consecutive identical outcomes, pins approved price_moved', async () => {
    await check(0, 'no_quote'); await check(1, 'no_quote'); await check(2, 'no_quote');
    await trade(3);
    await check(4, 'no_quote');
    await check(5, 'price_moved'); await check(6, 'price_moved');
    await check(7, 'price_moved', '9'); await check(8, 'price_moved', '9');
    await check(9, 'expired');
    const items = await all(100);
    expect(items.map((i) => [i.outcome, i.count ?? null])).toEqual([
      ['expired', 1], ['price_moved', 1], ['price_moved', 1], ['price_moved', 2], ['no_quote', 1], ['filled', null], ['no_quote', 3],
    ]);
    const run = items[6];
    expect(run).toMatchObject({ kind: 'check', createdAt: t(0).toISOString(), firstAt: t(0).toISOString(), lastAt: t(2).toISOString() });
    expect(items[1]).toMatchObject({ approvalId: '9', firstAt: t(8).toISOString(), lastAt: t(8).toISOString() });
    // Paging with every page size returns the same items, no dupes or gaps.
    for (const n of [1, 2, 3]) expect((await all(n)).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('cursor stays stable when a collapsed run grows', async () => {
    await check(0, 'no_quote'); await trade(1); await check(2, 'no_quote'); await check(3, 'no_quote');
    const p1: any = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity?limit=1` })).body;
    expect(p1.items[0]).toMatchObject({ outcome: 'no_quote', count: 2 });
    await check(4, 'no_quote');
    const p2: any = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity?limit=5&cursor=${p1.nextCursor}` })).body;
    expect(p2.items.map((i: any) => i.outcome)).toEqual(['filled', 'no_quote']);
    const head: any = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity?limit=1` })).body;
    expect(head.items[0]).toMatchObject({ id: p1.items[0].id, count: 3, lastAt: t(4).toISOString() });
  });

  it('status exposes lastOutcome and lastOutcomeAt', async () => {
    let s: any = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/status` })).body;
    expect(s).toMatchObject({ lastOutcome: null, lastOutcomeAt: null });
    await check(0, 'no_quote'); await check(5, 'price_moved');
    s = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/status` })).body;
    expect(s).toMatchObject({ lastOutcome: 'price_moved', lastOutcomeAt: t(5).toISOString() });
  });

  it('executed approvals carry fillRateNgnPerUsd + amountOut from the Swapped amounts; null otherwise', async () => {
    const ins = (id: string, tin: string, tout: string) => db.query(
      `INSERT INTO approvals (vault, onchain_id, token_in, token_out, amount_in, min_out, usd_value, reason, expires_at)
       VALUES ($1,$2,$3,$4,'1','1','1','r','2026-10-15T00:00:00Z')`, [VAULT, id, tin, tout]);
    await ins('1', CNGN, USDT); await ins('2', USDT, CNGN); await ins('3', CNGN, USDT);
    for (const id of ['1', '2']) await markApproved(db, VAULT, id, t(60), t(0));
    await markExecuted(db, VAULT, '1', '0xa', t(1), { amountIn: e18(136_200), amountOut: e18(100) });
    await markExecuted(db, VAULT, '2', '0xb', t(1), { amountIn: e18(50), amountOut: e18(68_000) });
    const items: any[] = ((await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/approvals` })).body as any).items;
    const by = (id: string) => items.find((i) => i.id === id);
    expect(by('1')).toMatchObject({ status: 'executed', fillRateNgnPerUsd: '1362.00', amountOut: e18(100).toString() });
    expect(by('2')).toMatchObject({ status: 'executed', fillRateNgnPerUsd: '1360.00', amountOut: e18(68_000).toString() });
    expect(by('3')).toMatchObject({ fillRateNgnPerUsd: null, amountOut: null });
  });

  it('fillRate is normalised by decimals and always agrees with amountOut', () => {
    const dec = { cngn: 6, usdt: 6 };
    for (const [ngnIn, aIn, aOut] of [[true, 1_362_000_000n, 1_000_000n], [false, 2_500_000n, 3_400_000_000n], [true, 999_999n, 733n]] as const) {
      const r = Number(fillRate(ngnIn, aIn, aOut, dec));
      const usd = Number(ngnIn ? aOut : aIn) / 1e6; const ngn = Number(ngnIn ? aIn : aOut) / 1e6;
      expect(r).toBeCloseTo(ngn / usd, 2);
      // amountOut implied by rate matches the reported amountOut (to rounding of 2dp rate).
      const implied = ngnIn ? (Number(aIn) / 1e6) / r : (Number(aIn) / 1e6) * r;
      expect(Math.abs(implied - Number(aOut) / 1e6) / (Number(aOut) / 1e6)).toBeLessThan(1e-3);
    }
    expect(fillRate(true, e18(1362), 1_000_000n, { cngn: 18, usdt: 6 })).toBe('1362.00');
    expect(fillRate(true, 1n, 0n, dec)).toBeNull();
  });
});
