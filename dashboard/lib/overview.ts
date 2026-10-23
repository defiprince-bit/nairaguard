/** Overview data: on-chain vault balances (viem) + agent API (per-vault balances/rate/P&L, activity, approvals, agent status). */
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { FACTORY_ADDRESS, factoryAbi } from './vault';
import { isCheck } from './format';
import type { ApiLimits } from './overviewView';
import type { ActivityItem, AgentStatus, ApprovalItem, BalancesResponse, Money, VaultStatus } from './types';

export const CHAIN = process.env.NEXT_PUBLIC_NETWORK === 'celo' ? celo : celoSepolia;
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);
const feedAbi = parseAbi(['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)']);
const vaultLimitsAbi = parseAbi(['function limits() view returns (uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps)']);
/** Chainlink NGN/USD on Celo mainnet (8 decimals, USD per 1 NGN). */
export const NGN_USD_FEED = '0xc17cBE2dB40e53F4984C46F608DA6DA1fF074c11' as const;

/** ₦ per $1 from a Chainlink answer (USD per NGN, 8 decimals); null when unusable. */
export function ngnPerUsdFromAnswer(answer: bigint, decimals = 8): number | null {
  if (answer <= 0n) return null;
  const r = 10 ** decimals / Number(answer);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Onchain fallback rate (public RPC, read-only). Mainnet only; null on testnet or any failure. */
export async function readFeedRate(): Promise<number | null> {
  if (CHAIN.id !== celo.id) return null;
  try {
    const r = await pc().readContract({ address: NGN_USD_FEED, abi: feedAbi, functionName: 'latestRoundData' });
    return ngnPerUsdFromAnswer(r[1]);
  } catch {
    return null;
  }
}

/** Vault limits read straight from the vault contract (fallback when the agent API can't serve them). */
export async function readVaultLimits(vault: `0x${string}`): Promise<ApiLimits> {
  const l = await pc().readContract({ address: vault, abi: vaultLimitsAbi, functionName: 'limits' });
  return { maxTradeUsd: l[0].toString(), maxDailyUsd: l[1].toString(), approvalThresholdUsd: l[2].toString(), maxSlippageBps: Number(l[3]), targetNgnBps: Number(l[4]) };
}

export type Pnl = { pnlNgn: string; pnlUsd: string; pnlSince: string };
export type OverviewBalances = BalancesResponse & { pnl: Pnl | null; rateKnown: boolean; lastCheckedAt?: string | null };

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

type ApiBalances = Partial<BalancesResponse> & { lastCheckedAt?: string | null; pnlNgn?: string | null; pnlUsd?: string | null; pnlSince?: string | null; balances?: Money[] };

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
  fallbackRate: number | null = null,
): OverviewBalances {
  const apiC = api?.balances?.find((b) => b.token === 'cNGN');
  const apiU = api?.balances?.find((b) => b.token === 'USDT');
  // Agent rate first, then the reference (Chainlink) rate, so a funded vault never reads ₦0.
  const rate = Number(apiC?.rate || apiU?.rate || 0) || (fallbackRate && fallbackRate > 0 ? fallbackRate : 0);
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
    lastCheckedAt: api?.lastCheckedAt ?? null,
  };
}

export async function getJson<T>(path: string): Promise<{ ok: boolean; status: number; data: T | null; mock: boolean }> {
  const r = await fetch(`/api/agent/${path}`, { cache: 'no-store' });
  const data = (await r.json().catch(() => null)) as T | null;
  return { ok: r.ok, status: r.status, data, mock: r.headers.get('x-nairaguard-mock') === '1' };
}

export type OverviewData = {
  balances: OverviewBalances | null;
  activity: ActivityItem[];
  approvals: ApprovalItem[];
  agent: AgentStatus | null;
  limits: ApiLimits | null;
  vaultCheckedAt: string | null;
  vaultCheckOk: boolean | null;
  apiDown: boolean;
  feedRate: string | null;
  feedUpdatedAt: string | null;
  paused: VaultStatus['paused'];
};

export async function loadOverview(vault: `0x${string}`): Promise<OverviewData> {
  const v = vault.toLowerCase();
  const [chainRaw, bal, act, appr, agent, lim, st] = await Promise.all([
    FACTORY_ADDRESS ? readVaultBalances(vault).catch(() => null) : Promise.resolve(null),
    getJson<ApiBalances>(`vault/${v}/balances`).catch(() => null),
    getJson<{ items: ActivityItem[] }>(`vault/${v}/activity?limit=20`).catch(() => null),
    getJson<{ items: ApprovalItem[] }>(`vault/${v}/approvals`).catch(() => null),
    getJson<AgentStatus>('agent').catch(() => null),
    getJson<ApiLimits>(`vault/${v}/limits`).catch(() => null),
    getJson<VaultStatus>(`vault/${v}/status`).catch(() => null),
  ]);
  // Dev mock mode (AGENT_API_URL unset locally): use the mock balances instead of chain reads.
  const chain = bal?.mock ? null : chainRaw;
  const apiRate = Number(bal?.ok ? bal.data?.balances?.find((b) => b.rate)?.rate ?? 0 : 0);
  const feedRate = st?.ok && st.data?.feedRate ? Number(st.data.feedRate) : null;
  const fallbackRate = apiRate > 0 ? null : feedRate && feedRate > 0 ? feedRate : await readFeedRate();
  const limits = lim?.ok && lim.data ? lim.data : FACTORY_ADDRESS && !bal?.mock ? await readVaultLimits(vault).catch(() => null) : null;
  // 404 unknown_vault / 503 no_rate_yet = new vault the agent hasn't quoted yet: not an error.
  const apiBal = bal?.ok ? bal.data : null;
  const apiDown = !agent?.ok;
  if (!chain && !apiBal) {
    if (apiDown) throw new Error('unavailable');
  }
  return {
    balances: chain || apiBal ? mergeBalances(chain, apiBal, limits?.targetNgnBps ?? null, fallbackRate) : null,
    // No-trade checks are Activity-tab only; Overview's recent list shows money moving.
    activity: act?.ok ? (act.data?.items ?? []).filter((it) => !isCheck(it)) : [],
    approvals: appr?.ok ? appr.data?.items ?? [] : [],
    agent: agent?.ok ? agent.data : null,
    limits,
    /** Per-vault last agent check from /api/vault/:address/status (preferred over the global lastRunAt). */
    vaultCheckedAt: st?.ok ? st.data?.lastCheckedAt ?? null : null,
    vaultCheckOk: st?.ok ? st.data?.ok ?? null : null,
    apiDown,
    feedRate: st?.ok ? st.data?.feedRate ?? null : null,
    feedUpdatedAt: st?.ok ? st.data?.feedUpdatedAt ?? null : null,
    paused: st?.ok ? st.data?.paused ?? null : null,
  };
}
