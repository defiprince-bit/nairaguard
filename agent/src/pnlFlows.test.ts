import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPublicClient, custom, type Log, parseUnits } from 'viem';
import { createApi } from './api.js';
import { type Db, migrate } from './db.js';
import { DEPOSITED, type LogReader, scanFlows, VAULT_CREATED, WITHDRAWN } from './factory.js';
import type { VaultState } from './loop.js';
import { getNetFlows, logQuote } from './pnl.js';

// Celo Sepolia vault 0x4C71…6c67 as of 17 Oct 2026 (mock tokens, 6 decimals).
const FACTORY = '0x7C0aDDFc500De0a2Ce06eBa399c3E55E47E2Aceb' as const;
const VAULT = '0x4C71ed3f68b90AEa0B7C820D126C2E15F2B26c67' as const;
const OWNER = '0x6cac00000000000000000000000000000000011f6';
const CNGN = '0xFA66cfEd00F4C079926fdC436185A010f1AD3123' as const;
const USDT = '0x6b941732c3B78D9232cd8332b8D3448B4a13beC0' as const;
const CHAIN = 11142220;
const u6 = (n: number) => parseUnits(String(n), 6);
const client = createPublicClient({ transport: custom({ request: async () => { throw new Error('offline'); } }) });

type F = { block: bigint; ev: 'dep' | 'wd'; token: string; amount: bigint; tx: string; logIndex: number };
class Reader implements LogReader {
  constructor(public head: bigint, public flows: F[]) {}
  async getBlockNumber() { return this.head; }
  async getLogs(a: Parameters<LogReader['getLogs']>[0]): Promise<Log[]> {
    if (a.event === VAULT_CREATED) return [];
    const ev = a.event === DEPOSITED ? 'dep' : a.event === WITHDRAWN ? 'wd' : null;
    return this.flows.filter((f) => f.ev === ev && f.block >= a.fromBlock && f.block <= a.toBlock).map((f) => ({
      address: VAULT, blockNumber: f.block, transactionHash: f.tx, logIndex: f.logIndex,
      args: { token: f.token, amount: f.amount, from: OWNER, to: OWNER },
    }) as unknown as Log);
  }
}

// The six real USD₮ deposits: $5, $1, $1, $1, $8, $2 = $18.
const DEPOSITS: F[] = [
  [38725218n, 5], [38728569n, 1], [38770867n, 1], [38771090n, 1], [38966215n, 8], [38968809n, 2],
].map(([b, n], i) => ({ block: b as bigint, ev: 'dep', token: USDT, amount: u6(n as number), tx: `0x${(i + 1).toString(16).padStart(64, '0')}`, logIndex: 2 }));

let db: Db;
let live: VaultState;
const state = (ngn: bigint, usd: bigint): VaultState => ({
  ngnBalance: ngn, usdBalance: usd, ngnDecimals: 6, usdDecimals: 6, dailySpentUsd: 0n, dayStart: 0n, paused: false,
  limits: { maxTradeUsd: u6(100), maxDailyUsd: u6(500), approvalThresholdUsd: u6(100), maxSlippageBps: 100, targetNgnBps: 5000 },
});
const api = () => createApi({
  chainId: CHAIN, db, agentAddress: '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4', tokens: { cngn: CNGN, usdt: USDT },
  decimals: { cngn: 6, usdt: 6 }, readState: async () => live,
  siwe: { domain: 'x', uri: 'https://x', chainId: 42220, client: client as never }, now: () => new Date('2026-10-17T16:05:00Z'),
});
const scan = (r: Reader) => scanFlows({ db, client: r, factory: FACTORY, chainId: CHAIN, startBlock: 38723073n, chunk: 50_000n });

beforeEach(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  await db.query(`INSERT INTO vaults (vault, owner, factory, chain_id, created_block, created_tx) VALUES ($1,$2,$3,$4,38725000,'0xc')`,
    [VAULT.toLowerCase(), OWNER, FACTORY.toLowerCase(), CHAIN]);
  // Baseline was taken after the first $5 deposit only (first tick that saw the vault funded).
  await logQuote(db, VAULT, 0n, u6(5), 1361, new Date('2026-10-14T20:21:00Z'), { ngn: 6, usd: 6 }, CHAIN);
  // Live balances now: 12,249.4083 cNGN + 8.9997 USD₮ ≈ ₦24,498 ≈ $18.
  live = state(12_249_408_300n, 8_999_700n);
});

describe('P&L net of deposits (vault 0x4C71…6c67)', () => {
  it('reproduces the bug without flows: later deposits count as profit (+$13, +260%)', async () => {
    const b = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/balances` })).body as any;
    expect(Number(b.pnlUsd)).toBeCloseTo(13, 1); // the old, wrong number
  });

  it('with deposits scanned, P&L is ~0 because $18 went in and the vault is worth ~$18', async () => {
    const r = await scan(new Reader(38970000n, DEPOSITS));
    expect(r.flows).toBe(6);
    const nf = await getNetFlows(db, VAULT, { cngn: CNGN, usdt: USDT }, CHAIN);
    expect(nf).toMatchObject({ ngnStart: '0', usdStart: u6(18).toString() });
    const b = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/balances` })).body as any;
    expect(Math.abs(Number(b.pnlNgn))).toBeLessThan(1); // 24,498.00 − 18 × 1,361 = 0.00
    expect(Math.abs(Number(b.pnlUsd))).toBeLessThan(0.01);
    expect(b.pnlSince).toBe('2026-10-14T20:21:00.000Z');
  });

  it('withdrawals reduce the basis, and rescans are idempotent with a resumable cursor', async () => {
    const wd: F = { block: 38969000n, ev: 'wd', token: USDT, amount: u6(3), tx: `0x${'ff'.padStart(64, '0')}`, logIndex: 0 };
    await scan(new Reader(38968000n, [...DEPOSITS, wd])); // first pass stops before the last deposit + withdrawal
    const again = await scan(new Reader(38970000n, [...DEPOSITS, wd]));
    expect(again.from).toBe(38968001n);
    expect(again.flows).toBe(2);
    live = state(12_249_408_300n, 5_999_700n); // $3 withdrawn → worth ~$15
    const nf = await getNetFlows(db, VAULT, { cngn: CNGN, usdt: USDT }, CHAIN);
    expect(nf?.usdStart).toBe(u6(15).toString());
    const b = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/balances` })).body as any;
    expect(Math.abs(Number(b.pnlUsd))).toBeLessThan(0.01);
  });

  it('a real gain still shows: rate moves after holding the same money', async () => {
    await scan(new Reader(38970000n, DEPOSITS));
    // Held 50/50; naira weakens to ₦1,500/$. Holding $18 of USD₮ would be ₦27,000; the vault holds ₦12,249 + $9.
    const p = await logQuote(db, VAULT, 12_249_408_300n, 8_999_700n, 1500, new Date('2026-10-18T00:00:00Z'), { ngn: 6, usd: 6 }, CHAIN, { cngn: CNGN, usdt: USDT });
    expect(p.holdValueNgn).toBeCloseTo(27_000, 0);
    expect(p.pnlNgn).toBeCloseTo(12_249.4083 + 8.9997 * 1500 - 27_000, 2);
  });
});

describe('activity: consecutive no-trade checks collapse', () => {
  it('groups same-code checks into one item with count, firstAt, lastAt and the latest reason', async () => {
    const ins = (code: string, reason: string, at: string) => db.query(
      `INSERT INTO activity (vault, kind, reason, status, check_code, created_at) VALUES ($1,'noop',$2,'skipped',$3,$4)`, [VAULT, reason, code, at]);
    await ins('in_band', 'Naira share is 49%, target 50%. That\'s within the 5% band, so no trade.', '2026-10-17T10:00:00Z');
    await ins('in_band', 'Naira share is 50%, target 50%. That\'s within the 5% band, so no trade.', '2026-10-17T11:00:00Z');
    await ins('below_min', 'Rebalancing would move only $0.50, so no trade.', '2026-10-17T12:00:00Z');
    const body = (await api().handle({ method: 'GET', url: `/api/vault/${VAULT}/activity` })).body as any;
    expect(body.items).toHaveLength(2);
    expect(body.items[1]).toMatchObject({
      kind: 'check', outcome: null, status: 'skipped', code: 'in_band', count: 2,
      firstAt: '2026-10-17T10:00:00.000Z', lastAt: '2026-10-17T11:00:00.000Z',
      reason: 'Naira share is 50%, target 50%. That\'s within the 5% band, so no trade.',
    });
    expect(body.items[0]).toMatchObject({ kind: 'check', code: 'below_min', count: 1 });
    expect(body.items[1].in).toBeUndefined();
    expect(body.items[1].txHash).toBeUndefined();
  });
});
