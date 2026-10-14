import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Hex, type Log, decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseUnits } from 'viem';
import { fromDataSuffix } from '@celo/attribution-tags';
import { ATTRIBUTION_TAG } from './config.js';
import { type Db, migrate } from './db.js';
import { type ChainPort, runOnce, type VaultState } from './loop.js';
import { FixedRateSource } from './textile.js';
import type { TaggedTx } from './txBuilder.js';
import { vaultAbi } from './vaultAbi.js';

const VAULT = '0xD436aA344C0E2a58a607443680651a2c32066be6' as const;
const CNGN = '0xaA3B7364E418deC4Fb147f1BD2d95A4022082aEA' as const;
const USDT = '0xe123971ec3F56138766272B7b15Ee188fdD0eFf7' as const;
const e18 = (n: number) => parseUnits(String(n), 18);

function state(over: Partial<VaultState> = {}): VaultState {
  return {
    ngnBalance: e18(300_000),
    usdBalance: e18(100),
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

class FakeChain implements ChainPort {
  sent: TaggedTx[] = [];
  constructor(private s: VaultState, private logs: Log[] = []) {}
  async readState() {
    return this.s;
  }
  async send(tx: TaggedTx) {
    this.sent.push(tx);
    return { hash: `0x${'ab'.repeat(32)}` as Hex, status: 'success' as const, logs: this.logs };
  }
}

let db: Db;
beforeEach(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
});

const deps = (chain: ChainPort) => ({
  vault: VAULT, cngn: CNGN, usdt: USDT, chain, rates: new FixedRateSource(1500), db,
  now: () => new Date('2026-10-14T12:00:00Z'),
});

describe('agent loop', () => {
  it('swaps below threshold with tagged calldata and records activity', async () => {
    const chain = new FakeChain(state());
    const r = await runOnce(deps(chain));
    expect(r.decision.action).toBe('swap');
    expect(chain.sent).toHaveLength(1);
    const tx = chain.sent[0]!;
    expect(tx.to).toBe(VAULT);
    expect(fromDataSuffix(tx.data)?.codes).toContain(ATTRIBUTION_TAG);
    const call = decodeFunctionData({ abi: vaultAbi, data: tx.data });
    expect(call.functionName).toBe('swap');
    expect(call.args[0]).toBe(CNGN);
    const usd = Number(call.args[4] as bigint) / 1e18;
    expect(usd).toBeGreaterThan(49.9);
    expect(usd).toBeLessThan(50.1); // ~$50 rebalance

    const { rows } = await db.query<{ kind: string; status: string; tx_hash: string }>('SELECT * FROM activity');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'swap', status: 'confirmed' });

    // Quote + baseline logged before the swap, and again after it with per-swap fee/P&L.
    const q = await db.query('SELECT * FROM quotes');
    expect(q.rows).toHaveLength(2);
    const b = await db.query<{ rate_start: string }>('SELECT * FROM vault_baseline');
    expect(b.rows[0]?.rate_start).toBe('1500');
    const a = await db.query<{ fee_ngn: string | null }>("SELECT fee_ngn FROM activity WHERE kind='swap'");
    expect(a.rows[0]?.fee_ngn).not.toBeNull();
  });

  it('does nothing inside the band and records a skip', async () => {
    const chain = new FakeChain(state({ ngnBalance: e18(150_000), usdBalance: e18(100) }));
    const r = await runOnce(deps(chain));
    expect(r.decision.action).toBe('none');
    expect(chain.sent).toHaveLength(0);
    const { rows } = await db.query<{ status: string }>('SELECT status FROM activity');
    expect(rows[0]?.status).toBe('skipped');
  });

  it('does not trade while paused', async () => {
    const chain = new FakeChain(state({ paused: true }));
    const r = await runOnce(deps(chain));
    expect(r.skipped).toMatch(/paused/);
    expect(chain.sent).toHaveLength(0);
  });

  it('resets the daily allowance after a day', async () => {
    const chain = new FakeChain(state({ dailySpentUsd: e18(500), dayStart: 0n }));
    const r = await runOnce(deps(chain));
    expect(r.decision.action).toBe('swap');
  });

  it('proposes above threshold, stores the approval, and does not double-propose', async () => {
    const topics = encodeEventTopics({ abi: vaultAbi, eventName: 'SwapProposed', args: { id: 7n } });
    const data = encodeAbiParameters([{ type: 'uint64' }], [1_800_000_000n]);
    const log = { address: VAULT, topics, data } as unknown as Log;
    const s = state({
      limits: { ...state().limits, approvalThresholdUsd: e18(10) },
    });
    const chain = new FakeChain(s, [log]);
    const r = await runOnce(deps(chain));
    expect(r.decision.action).toBe('propose');
    const call = decodeFunctionData({ abi: vaultAbi, data: chain.sent[0]!.data });
    expect(call.functionName).toBe('proposeSwap');
    const { rows } = await db.query<{ onchain_id: string; status: string }>('SELECT * FROM approvals');
    expect(rows[0]).toMatchObject({ onchain_id: '7', status: 'pending' });

    const again = await runOnce(deps(chain));
    expect(again.skipped).toMatch(/already waiting/);
    expect(chain.sent).toHaveLength(1);
  });
});
