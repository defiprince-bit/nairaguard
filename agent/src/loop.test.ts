import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Hex, type Log, decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseUnits } from 'viem';
import { fromDataSuffix } from '@celo/attribution-tags';
import { ATTRIBUTION_TAG } from './config.js';
import { type Db, markApproved, markRejected, migrate } from './db.js';
import type { FeedReading } from './feed.js';
import { type ChainPort, NO_OFFER, runOnce, STALE_PRICE, type VaultState } from './loop.js';
import type { RfqClient, RfqRequest, RfqResult } from './rfq.js';
import { FixedRateSource } from './textile.js';
import type { TaggedTx } from './txBuilder.js';
import { vaultAbi } from './vaultAbi.js';

const VAULT = '0xD436aA344C0E2a58a607443680651a2c32066be6' as const;
const CNGN = '0xaA3B7364E418deC4Fb147f1BD2d95A4022082aEA' as const;
const USDT = '0xe123971ec3F56138766272B7b15Ee188fdD0eFf7' as const;
const REACTOR = '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3' as const;
const DEX = '0x00000000000000000000000000000000000de0e0' as const;
const NOW = new Date('2026-10-14T12:00:00Z');
const e6 = (n: number) => parseUnits(String(n), 6);
const e18 = (n: number) => parseUnits(String(n), 18);

function state(over: Partial<VaultState> = {}): VaultState {
  return {
    ngnBalance: e6(300_000),
    usdBalance: e6(100),
    ngnDecimals: 6,
    usdDecimals: 6,
    limits: {
      maxTradeUsd: e18(100),
      maxDailyUsd: e18(500),
      approvalThresholdUsd: e18(100),
      maxSlippageBps: 100,
      targetNgnBps: 5_000,
    },
    dailySpentUsd: 0n,
    dayStart: 0n,
    paused: false,
    ...over,
  };
}

const freshFeed = (over: Partial<FeedReading> = {}): FeedReading => ({
  rateNgnPerUsd: 1330, answer: 75188n, decimals: 8, updatedAt: new Date(NOW.getTime() - 60_000), stale: false, ...over,
});

const swappedLog = (amountOut: bigint, target: `0x${string}` = REACTOR, id = 0n) => ({
  address: VAULT,
  topics: encodeEventTopics({ abi: vaultAbi, eventName: 'Swapped', args: { id } }),
  data: encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
    [CNGN, USDT, e6(75_000), amountOut, target]),
}) as unknown as Log;

class FakeChain implements ChainPort {
  sent: TaggedTx[] = [];
  status: 'success' | 'reverted' = 'success';
  feed = freshFeed();
  floor = 0n;
  allowed = true;
  labels: Record<string, string> = { [REACTOR.toLowerCase()]: 'textile', [DEX.toLowerCase()]: 'dex' };
  constructor(private s: VaultState, public logs: Log[] = []) {}
  async readState() { return this.s; }
  async send(tx: TaggedTx) {
    this.sent.push(tx);
    return { hash: `0x${'ab'.repeat(32)}` as Hex, status: this.status, logs: this.logs };
  }
  async readFeed() { return this.feed; }
  async minOutFloor() { return this.floor; }
  async isAllowedVenue() { return this.allowed; }
  async venueLabel(t: `0x${string}`) { return this.labels[t.toLowerCase()] ?? ''; }
}

/** Quotes at ₦1,361/$ with a 1-minute expiry, like a Textile firm quote. */
class FakeRfq implements RfqClient {
  readonly venue = 'textile';
  reqs: RfqRequest[] = [];
  next?: RfqResult;
  rate = 1361;
  expiresInMs = 60_000;
  async request(r: RfqRequest): Promise<RfqResult> {
    this.reqs.push(r);
    if (this.next) return this.next;
    const sellingNgn = r.sellToken === CNGN;
    const buyAmount = sellingNgn ? (r.sellAmount * 1000n) / BigInt(this.rate * 1000) : r.sellAmount * BigInt(this.rate);
    return {
      quoted: true, takerPays: r.sellAmount, buyAmount, spender: REACTOR, target: REACTOR, data: '0xdeadbeef',
      expiresAt: new Date(NOW.getTime() + this.expiresInMs),
    };
  }
}

let db: Db;
beforeEach(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
});

const deps = (chain: ChainPort, rfq: RfqClient = new FakeRfq()) => ({
  vault: VAULT, cngn: CNGN, usdt: USDT, chainId: 42220, chain, rfq, rates: new FixedRateSource(1500), db, now: () => NOW,
});
const quotes = async () => (await db.query<Record<string, any>>('SELECT * FROM textile_quotes ORDER BY id')).rows;
const acts = async () => (await db.query<Record<string, any>>('SELECT * FROM activity ORDER BY id')).rows;

describe('RFQ swap (below threshold)', () => {
  it('requests a quote with taker = vault and sends a tagged swapViaRfq to the vault', async () => {
    const rfq = new FakeRfq();
    const chain = new FakeChain(state(), [swappedLog(55_106_539n)]);
    const r = await runOnce(deps(chain, rfq));
    expect(r.outcome).toBe('filled');
    expect(rfq.reqs[0]).toMatchObject({ taker: VAULT, sellToken: CNGN, buyToken: USDT, chainId: 42220 });
    const sell = rfq.reqs[0]!.sellAmount;
    expect(Number(sell) / 1e6).toBeCloseTo(75_000, -2); // ~$50 rebalance at ₦1,500, 6 dp
    expect(chain.sent).toHaveLength(1);
    const tx = chain.sent[0]!;
    expect(tx.to).toBe(VAULT);
    // Attribution tag rides on the agent's own tx to the vault (the vault then calls the reactor).
    expect(fromDataSuffix(tx.data)?.codes).toContain(ATTRIBUTION_TAG);
    const call = decodeFunctionData({ abi: vaultAbi, data: tx.data });
    expect(call.functionName).toBe('swapViaRfq');
    expect(call.args).toEqual([CNGN, USDT, sell, (sell * 1000n) / 1_361_000n, REACTOR, REACTOR, '0xdeadbeef', 0n]);
  });

  it('logs the quote with size, side, rate, expiry, feed rate, outcome and tx hash', async () => {
    const chain = new FakeChain(state(), [swappedLog(55_106_539n)]);
    await runOnce(deps(chain));
    const [q] = await quotes();
    expect(q).toMatchObject({ side: 'ngnToUsd', quoted: true, outcome: 'filled', venue: 'textile' });
    expect(Number(q!.sell_amount) / 1e6).toBeCloseTo(75_000, -2);
    expect(Number(q!.rate_ngn_per_usd)).toBeCloseTo(1361, 0);
    expect(Number(q!.feed_rate_ngn_per_usd)).toBe(1330);
    expect(Number(q!.size_usd)).toBeCloseTo(50, 1);
    expect(q!.expires_at).not.toBeNull();
    expect(q!.tx_hash).toBe(`0x${'ab'.repeat(32)}`);
    expect(q!.amount_out).toBe('55106539');
  });

  it('records amountOut from the Swapped event and venue from its on-chain target', async () => {
    const chain = new FakeChain(state(), [swappedLog(55_000_000n)]);
    await runOnce(deps(chain));
    const a = (await acts()).find((x) => x.kind === 'swap')!;
    expect(a).toMatchObject({ amount_out: '55000000', status: 'confirmed', venue: 'textile', venue_target: REACTOR.toLowerCase() });
    expect(a.amount_out).not.toBe(a.min_out);
    expect(a.fee_ngn).not.toBeNull();
  });

  it('never takes the venue from the quote: a Swapped target labelled "dex" is recorded as dex', async () => {
    const chain = new FakeChain(state(), [swappedLog(55_000_000n, DEX)]);
    await runOnce(deps(chain)); // quote claims the Textile reactor
    const a = (await acts()).find((x) => x.kind === 'swap')!;
    expect(a.venue).toBe('dex');
  });

  it('falls back to the tokenOut balance delta when no Swapped event is found', async () => {
    let n = 0;
    const chain = new FakeChain(state());
    chain.readState = async () => (n++ === 0 ? state() : state({ ngnBalance: e6(225_000), usdBalance: e6(149.8) }));
    await runOnce(deps(chain));
    const a = (await acts()).find((x) => x.kind === 'swap')!;
    expect(a.amount_out).toBe(e6(49.8).toString());
    expect(a.venue).toBeNull();
  });

  it('logs no_quote and a quiet activity line when there is no offer', async () => {
    const rfq = new FakeRfq();
    rfq.next = { quoted: false, reason: 'no_api_key' };
    const chain = new FakeChain(state());
    const r = await runOnce(deps(chain, rfq));
    expect(r.outcome).toBe('no_quote');
    expect(chain.sent).toHaveLength(0);
    expect(await quotes()).toMatchObject([{ quoted: false, outcome: 'no_quote', outcome_reason: 'no_api_key', feed_rate_ngn_per_usd: '1330' }]);
    expect((await acts()).at(-1)).toMatchObject({ kind: 'noop', reason: NO_OFFER, status: 'skipped' });
  });

  it('declines before sending when the quote is below the vault floor', async () => {
    const chain = new FakeChain(state());
    chain.floor = e6(60);
    const r = await runOnce(deps(chain));
    expect(r.outcome).toBe('declined');
    expect(chain.sent).toHaveLength(0);
    expect((await quotes())[0]).toMatchObject({ outcome: 'declined', outcome_reason: 'below_feed_floor' });
  });

  it('declines a quote whose (target, spender) is not allowlisted', async () => {
    const chain = new FakeChain(state());
    chain.allowed = false;
    expect((await runOnce(deps(chain))).outcome).toBe('declined');
    expect(chain.sent).toHaveLength(0);
  });

  it('declines a quote that asks for more than amountIn', async () => {
    const rfq = new FakeRfq();
    rfq.next = { quoted: true, takerPays: e6(80_000), buyAmount: e6(55), spender: REACTOR, target: REACTOR, data: '0x', expiresAt: new Date(NOW.getTime() + 60_000) };
    const chain = new FakeChain(state());
    expect((await runOnce(deps(chain, rfq))).outcome).toBe('declined');
    expect(chain.sent).toHaveLength(0);
  });

  it('logs expired (no tx) when the quote expired before sending', async () => {
    const rfq = new FakeRfq();
    rfq.expiresInMs = -1;
    const chain = new FakeChain(state());
    expect((await runOnce(deps(chain, rfq))).outcome).toBe('expired');
    expect(chain.sent).toHaveLength(0);
  });

  it('logs expired with the tx hash when the swap tx reverts', async () => {
    const chain = new FakeChain(state());
    chain.status = 'reverted';
    expect((await runOnce(deps(chain))).outcome).toBe('expired');
    expect((await quotes())[0]).toMatchObject({ outcome: 'expired', outcome_reason: 'tx_reverted', tx_hash: `0x${'ab'.repeat(32)}` });
  });
});

describe('agent loop guards', () => {
  it('pauses on a stale feed without requesting a quote', async () => {
    const rfq = new FakeRfq();
    const chain = new FakeChain(state());
    chain.feed = freshFeed({ stale: true });
    const r = await runOnce(deps(chain, rfq));
    expect(r.skipped).toBe(STALE_PRICE);
    expect(rfq.reqs).toHaveLength(0);
  });

  it('does nothing inside the band and records a skip', async () => {
    const chain = new FakeChain(state({ ngnBalance: e6(150_000), usdBalance: e6(100) }));
    const r = await runOnce(deps(chain));
    expect(r.decision?.action).toBe('none');
    expect(chain.sent).toHaveLength(0);
  });

  it('records a "checked" row only when the no-trade reason changes', async () => {
    const checks = async () => (await acts()).filter((a) => a.kind === 'noop' && a.check_code);
    const chain = new FakeChain(state({ ngnBalance: e6(150_000), usdBalance: e6(100) }));
    await runOnce(deps(chain));
    await runOnce(deps(chain));
    await runOnce(deps(chain));
    expect((await checks()).map((c) => c.check_code)).toEqual(['in_band']);
    expect((await checks())[0]).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/within the 5% band/) });
    // 1 USDT, no naira: the ideal move is $0.50, under the $1 minimum.
    const small = new FakeChain(state({ ngnBalance: 0n, usdBalance: e6(1) }));
    await runOnce(deps(small));
    await runOnce(deps(small));
    const c = await checks();
    expect(c.map((x) => x.check_code)).toEqual(['in_band', 'below_min']);
    expect(c[1].reason).toMatch(/only \$0\.50, under the \$1\.00 minimum/);
    await runOnce(deps(chain));
    expect((await checks()).map((x) => x.check_code)).toEqual(['in_band', 'below_min', 'in_band']);
  });

  it('records a fresh check after a trade even if the reason matches the last check', async () => {
    const inBand = new FakeChain(state({ ngnBalance: e6(150_000), usdBalance: e6(100) }));
    await runOnce(deps(inBand));
    await runOnce(deps(new FakeChain(state(), [swappedLog(55_000_000n)])));
    await runOnce(deps(inBand));
    expect((await acts()).filter((a) => a.check_code || a.kind === 'swap').map((a) => a.check_code ?? a.kind))
      .toEqual(['in_band', 'swap', 'in_band']);
  });

  it('does not trade while paused', async () => {
    const chain = new FakeChain(state({ paused: true }));
    expect((await runOnce(deps(chain))).skipped).toMatch(/paused/);
    expect(chain.sent).toHaveLength(0);
  });

  it('resets the daily allowance after a day', async () => {
    const chain = new FakeChain(state({ dailySpentUsd: e18(500), dayStart: 0n }), [swappedLog(55_000_000n)]);
    expect((await runOnce(deps(chain))).decision?.action).toBe('swap');
  });
});

const proposedLog = (id: bigint) => ({
  address: VAULT,
  topics: encodeEventTopics({ abi: vaultAbi, eventName: 'SwapProposed', args: { id } }),
  data: encodeAbiParameters([{ type: 'uint64' }], [1_800_000_000n]),
}) as unknown as Log;
const lowThreshold = () => state({ limits: { ...state().limits, approvalThresholdUsd: e18(10) } });

describe('approvals', () => {
  it('proposes above threshold with minOut ≥ the vault floor, stores it, and does not double-propose', async () => {
    const chain = new FakeChain(lowThreshold(), [proposedLog(7n)]);
    chain.floor = e6(60); // above the strategy's own minOut
    const r = await runOnce(deps(chain));
    expect(r.decision?.action).toBe('propose');
    const call = decodeFunctionData({ abi: vaultAbi, data: chain.sent[0]!.data });
    expect(call.functionName).toBe('proposeSwap');
    expect(call.args).toHaveLength(4);
    expect(call.args[3]).toBe(e6(60));
    const { rows } = await db.query<{ onchain_id: string; status: string; min_out: string }>('SELECT * FROM approvals');
    expect(rows[0]).toMatchObject({ onchain_id: '7', status: 'pending', min_out: e6(60).toString() });
    expect((await runOnce(deps(chain))).skipped).toMatch(/already waiting/);
    expect(chain.sent).toHaveLength(1);
  });

  it('runs an approved proposal with a fresh quote: price_moved below approvedMinOut, then fills', async () => {
    const chain = new FakeChain(lowThreshold(), [proposedLog(7n)]);
    await runOnce(deps(chain));
    const { rows } = await db.query<{ min_out: string }>('SELECT min_out FROM approvals');
    const approvedMinOut = BigInt(rows[0]!.min_out);
    await markApproved(db, VAULT, '7', new Date(NOW.getTime() + 30 * 60_000), NOW);

    const rfq = new FakeRfq();
    rfq.next = { quoted: true, takerPays: e6(75_000), buyAmount: approvedMinOut - 1n, spender: REACTOR, target: REACTOR, data: '0x01', expiresAt: new Date(NOW.getTime() + 60_000) };
    const moved = await runOnce(deps(chain, rfq));
    expect(moved.outcome).toBe('price_moved');
    expect(chain.sent).toHaveLength(1);
    expect((await quotes()).at(-1)).toMatchObject({ outcome: 'price_moved', approval_id: '7' });
    expect((await acts()).at(-1)!.reason).toBe("Price moved, didn't trade.");

    rfq.next = { ...rfq.next, buyAmount: approvedMinOut + 1n };
    chain.logs = [swappedLog(approvedMinOut + 1n, REACTOR, 7n)];
    const filled = await runOnce(deps(chain, rfq));
    expect(filled.outcome).toBe('filled');
    const call = decodeFunctionData({ abi: vaultAbi, data: chain.sent[1]!.data });
    expect(call.functionName).toBe('swapViaRfq');
    expect(call.args[7]).toBe(7n);
    const st = await db.query<{ status: string; executed_tx: string }>('SELECT status, executed_tx FROM approvals');
    expect(st.rows[0]).toMatchObject({ status: 'executed', executed_tx: `0x${'ab'.repeat(32)}` });
  });

  it('cools down after a rejection unless drift moves meaningfully', async () => {
    const chain = new FakeChain(lowThreshold(), [proposedLog(9n)]);
    let now = NOW;
    const dep = () => ({ ...deps(chain), now: () => now });
    expect((await runOnce(dep())).decision?.action).toBe('propose');
    await markRejected(db, VAULT, '9', '0xrej', now);
    now = new Date(NOW.getTime() + 3_600_000);
    expect((await runOnce(dep())).skipped).toMatch(/declined this trade recently/);
    const moved = new FakeChain(state({ limits: lowThreshold().limits, ngnBalance: e6(400_000) }), [proposedLog(10n)]);
    expect((await runOnce({ ...deps(moved), now: () => now })).decision?.action).toBe('propose');
  });

  it('re-proposes once the cooldown has passed', async () => {
    const chain = new FakeChain(lowThreshold(), [proposedLog(11n)]);
    let now = NOW;
    await runOnce({ ...deps(chain), now: () => now, rejectCooldownMs: 3_600_000 });
    await markRejected(db, VAULT, '11', '0xrej', now);
    now = new Date(NOW.getTime() + 3_600_001);
    expect((await runOnce({ ...deps(chain), now: () => now, rejectCooldownMs: 3_600_000 })).decision?.action).toBe('propose');
    expect(chain.sent).toHaveLength(2);
  });
});
