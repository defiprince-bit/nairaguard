/** Overview data: on-chain vault balances (viem) + agent API (per-vault balances/rate/P&L, activity, approvals, agent status). */
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { FACTORY_ADDRESS, factoryAbi } from './vault';
import type { ActivityItem, AgentStatus, ApprovalItem, BalancesResponse, Money } from './types';

export const CHAIN = process.env.NEXT_PUBLIC_NETWORK === 'celo' ? celo : celoSepolia;
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);

export type Pnl = { pnlNgn: string; pnlUsd: string; pnlSince: string };
export type OverviewBalances = BalancesResponse & { pnl: Pnl | null; rateKnown: boolean };

const makeClient = () => createPublicClient({ chain: CHAIN, transport: http() });
let client: ReturnType<typeof makeClient> | undefined;
const pc = () => (client ??= makeClient());

/** Raw token balances held by the vault, read directly from chain. */
export async function readVaultBalances(vault: `0x${string}`) {
  const factory = FACTORY_ADDRESS as `0x${string}`;
  const [cngn, usdt] = await Promise.all([
    pc().readContract({ address: factory, abi: factoryAbi, functionName: 'cNGN' }),
    pc().readContract({ address: factory, abi: factoryAbi, functionName: 'usdt' }),
  ]);
  const one = async (t: `0x${string}`) => {
    const [bal, dec] = await Promise.all([
      pc().readContract({ address: t, abi: erc20, functionName: 'balanceOf', args: [vault] }),
      pc().readContract({ address: t, abi: erc20, functionName: 'decimals' }),
    ]);
    return { raw: bal.toString(), decimals: Number(dec) };
  };
  const [n, u] = await Promise.all([one(cngn), one(usdt)]);
  return { cngn: n, usdt: u };
}

type ApiBalances = Partial<BalancesResponse> & { pnlNgn?: string | null; pnlUsd?: string | null; pnlSince?: string | null; balances?: Money[] };

/** P&L is shown only when the API returns it with a baseline date (pnlSince); otherwise hidden. */
export function pickPnl(b: ApiBalances | null | undefined): Pnl | null {
  if (!b || b.pnlNgn == null || b.pnlUsd == null || !b.pnlSince) return null;
  if (!Number.isFinite(Number(b.pnlNgn))) return null;
  return { pnlNgn: b.pnlNgn, pnlUsd: b.pnlUsd, pnlSince: b.pnlSince };
}

/**
 * Chain amounts are the source of truth; the API supplies the rate and values.
 * If the API has no rate/vault yet, still show token amounts (₦ for cNGN, $ for USD₮).
 */
export function mergeBalances(
  chain: { cngn: { raw: string; decimals: number }; usdt: { raw: string; decimals: number } } | null,
  api: ApiBalances | null,
  targetNgnBps: number | null,
): OverviewBalances {
  const apiC = api?.balances?.find((b) => b.token === 'cNGN');
  const apiU = api?.balances?.find((b) => b.token === 'USDT');
  const rate = Number(apiC?.rate ?? apiU?.rate ?? 0);
  const rateAt = apiC?.rateAt ?? apiU?.rateAt ?? new Date().toISOString();
  const ngnAmt = chain ? Number(formatUnits(BigInt(chain.cngn.raw), chain.cngn.decimals)) : Number(apiC?.amountNgn ?? 0);
  const usdAmt = chain ? Number(formatUnits(BigInt(chain.usdt.raw), chain.usdt.decimals)) : Number(apiU?.amountUsd ?? 0);
  const m = (token: Money['token'], amount: string, ngn: number, usd: number): Money => ({
    token, amount, amountNgn: ngn.toFixed(2), amountUsd: usd.toFixed(2), rate: rate ? String(rate) : '', rateAt,
  });
  const c = m('cNGN', chain?.cngn.raw ?? apiC?.amount ?? '0', ngnAmt, rate ? ngnAmt / rate : 0);
  const u = m('USDT', chain?.usdt.raw ?? apiU?.amount ?? '0', rate ? usdAmt * rate : 0, usdAmt);
  const totalNgn = ngnAmt + (rate ? usdAmt * rate : 0);
  const share = rate ? (totalNgn > 0 ? Math.round((ngnAmt / totalNgn) * 10_000) : 0) : (api?.ngnShareBps ?? 0);
  return {
    balances: [c, u],
    ngnShareBps: share,
    targetNgnBps: targetNgnBps ?? api?.targetNgnBps ?? 5000,
    pnl: pickPnl(api),
    rateKnown: rate > 0,
  };
}

async function getJson<T>(path: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  const r = await fetch(`/api/agent/${path}`, { cache: 'no-store' });
  const data = (await r.json().catch(() => null)) as T | null;
  return { ok: r.ok, status: r.status, data };
}

export type OverviewData = {
  balances: OverviewBalances | null;
  activity: ActivityItem[];
  approvals: ApprovalItem[];
  agent: AgentStatus | null;
  apiDown: boolean;
};

export async function loadOverview(vault: `0x${string}`): Promise<OverviewData> {
  const v = vault.toLowerCase();
  const [chain, bal, act, appr, agent, lim] = await Promise.all([
    FACTORY_ADDRESS ? readVaultBalances(vault).catch(() => null) : Promise.resolve(null),
    getJson<ApiBalances>(`vault/${v}/balances`).catch(() => null),
    getJson<{ items: ActivityItem[] }>(`vault/${v}/activity`).catch(() => null),
    getJson<{ items: ApprovalItem[] }>(`vault/${v}/approvals`).catch(() => null),
    getJson<AgentStatus>('agent').catch(() => null),
    getJson<{ targetNgnBps: number }>(`vault/${v}/limits`).catch(() => null),
  ]);
  // 404 unknown_vault / 503 no_rate_yet = new vault the agent hasn't quoted yet: not an error.
  const apiBal = bal?.ok ? bal.data : null;
  const apiDown = !agent?.ok;
  if (!chain && !apiBal) {
    if (apiDown) throw new Error('unavailable');
  }
  return {
    balances: chain || apiBal ? mergeBalances(chain, apiBal, lim?.ok ? lim.data?.targetNgnBps ?? null : null) : null,
    activity: act?.ok ? act.data?.items ?? [] : [],
    approvals: appr?.ok ? appr.data?.items ?? [] : [],
    agent: agent?.ok ? agent.data : null,
    apiDown,
  };
}
