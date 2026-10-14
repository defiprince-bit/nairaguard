import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
/**
 * Dashboard tx builders for the VaultFactory flow (design.md §7).
 * Every tx the user's wallet sends (createVault, approve, deposit) carries the ERC-8021
 * attribution tag, appended with @celo/attribution-tags' toDataSuffix.
 */
import { toDataSuffix } from '@celo/attribution-tags';
import { type Hex, concatHex, decodeFunctionResult, encodeFunctionData, parseAbi, parseUnits } from 'viem';

export const ATTRIBUTION_TAG = 'celo_9efd0f97b491' as const;
export const ATTRIBUTION_SUFFIX: Hex = toDataSuffix(ATTRIBUTION_TAG);

export const ZERO = '0x0000000000000000000000000000000000000000' as const;
/** Celo Sepolia VaultFactory; override with NEXT_PUBLIC_FACTORY_ADDRESS (required for mainnet). */
export const SEPOLIA_FACTORY = '0x7C0aDDFc500De0a2Ce06eBa399c3E55E47E2Aceb' as const;
export const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  (process.env.NEXT_PUBLIC_NETWORK === 'celo' ? '' : SEPOLIA_FACTORY)) as `0x${string}` | '';

export const factoryAbi = parseAbi([
  'function createVault((uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps) limits) returns (address)',
  'function vaultOf(address owner) view returns (address)',
  'function cNGN() view returns (address)',
  'function usdt() view returns (address)',
]);
export const vaultAbi = parseAbi(['function deposit(address token, uint256 amount)']);
export const erc20Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)', 'function decimals() view returns (uint8)']);

export type Limits = {
  maxTradeUsd: bigint;
  maxDailyUsd: bigint;
  approvalThresholdUsd: bigint;
  maxSlippageBps: number;
  targetNgnBps: number;
};

export type PresetId = 'careful' | 'balanced' | 'active';
const usd = (n: number) => parseUnits(String(n), 18);
/** Presets per ui-spec (limits only; the target is chosen separately). */
export const DEFAULT_PRESET: PresetId = 'balanced';
export const PRESETS: Record<PresetId, { label: string; blurb: string; limits: Omit<Limits, 'targetNgnBps'> }> = {
  careful: {
    label: 'Careful',
    blurb: 'Up to $20 a trade · $50 a day · asks you above $5',
    limits: { maxTradeUsd: usd(20), maxDailyUsd: usd(50), approvalThresholdUsd: usd(5), maxSlippageBps: 50 },
  },
  balanced: {
    label: 'Balanced',
    blurb: 'Up to $50 a trade · $150 a day · asks you above $25',
    limits: { maxTradeUsd: usd(50), maxDailyUsd: usd(150), approvalThresholdUsd: usd(25), maxSlippageBps: 100 },
  },
  active: {
    label: 'Active',
    blurb: 'Up to $200 a trade · $500 a day · asks you above $100',
    limits: { maxTradeUsd: usd(200), maxDailyUsd: usd(500), approvalThresholdUsd: usd(100), maxSlippageBps: 100 },
  },
};

/** Target share kept in naira, in basis points (e.g. 5000 = 50% ₦ / 50% $). */
export function presetLimits(preset: PresetId, targetNgnPct: number): Limits {
  if (!(targetNgnPct >= 0 && targetNgnPct <= 100)) throw new Error('target must be 0–100%');
  return { ...PRESETS[preset].limits, targetNgnBps: Math.round(targetNgnPct * 100) };
}

export type Tx = { to: `0x${string}`; data: Hex };

export function tag(data: Hex): Hex {
  return data.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase()) ? data : concatHex([data, ATTRIBUTION_SUFFIX]);
}

export function buildCreateVault(factory: `0x${string}`, limits: Limits): Tx {
  return { to: factory, data: tag(encodeFunctionData({ abi: factoryAbi, functionName: 'createVault', args: [limits] })) };
}

export function buildApprove(token: `0x${string}`, vault: `0x${string}`, amount: bigint): Tx {
  return { to: token, data: tag(encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [vault, amount] })) };
}

export function buildDeposit(vault: `0x${string}`, token: `0x${string}`, amount: bigint): Tx {
  return { to: vault, data: tag(encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [token, amount] })) };
}

export function vaultOfCall(factory: `0x${string}`, owner: `0x${string}`): Tx {
  return { to: factory, data: encodeFunctionData({ abi: factoryAbi, functionName: 'vaultOf', args: [owner] }) };
}

export function decodeVaultOf(result: Hex): `0x${string}` | null {
  const v = decodeFunctionResult({ abi: factoryAbi, functionName: 'vaultOf', data: result });
  return v.toLowerCase() === ZERO ? null : v;
}

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/**
 * Reads vaultOf(owner) over the app's own public RPC for CHAIN, not the wallet's provider:
 * MiniPay sits on Celo mainnet, so an eth_call through it to a Sepolia factory returns 0x.
 */
export function appClient() {
  const chain = process.env.NEXT_PUBLIC_NETWORK === 'celo' ? celo : celoSepolia;
  return createPublicClient({ chain, transport: http() });
}

export async function lookupVault(factory: `0x${string}`, owner: `0x${string}`): Promise<`0x${string}` | null> {
  const pc = appClient();
  const r = await pc.call(vaultOfCall(factory, owner));
  return decodeVaultOf((r.data ?? '0x') as Hex);
}

/**
 * Polls the receipt over the app's own RPC, not the wallet's: MiniPay's read provider can be on a
 * different chain than the one it signs for, so it never returns (or errors on) the Sepolia receipt.
 */
export async function waitForReceipt(_eth: Eth, hash: Hex, tries = 60): Promise<{ status: Hex }> {
  const pc = appClient();
  for (let i = 0; i < tries; i++) {
    try {
      const rc = await pc.getTransactionReceipt({ hash });
      return { status: rc.status === 'success' ? '0x1' : '0x0' };
    } catch { /* not mined yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Timed out waiting for confirmation');
}

/** Read the factory's cNGN / USD₮ token addresses and decimals (deposit targets), over the app's RPC. */
export async function factoryTokens(_eth: Eth, factory: `0x${string}`): Promise<{
  cngn: `0x${string}`; usdt: `0x${string}`; decimals: { cngn: number; usdt: number };
}> {
  const pc = appClient();
  const [cngn, usdt] = await Promise.all([
    pc.readContract({ address: factory, abi: factoryAbi, functionName: 'cNGN' }) as Promise<`0x${string}`>,
    pc.readContract({ address: factory, abi: factoryAbi, functionName: 'usdt' }) as Promise<`0x${string}`>,
  ]);
  const dec = (a: `0x${string}`) => pc.readContract({ address: a, abi: erc20Abi, functionName: 'decimals' }).then(Number);
  const [dc, du] = await Promise.all([dec(cngn), dec(usdt)]);
  return { cngn, usdt, decimals: { cngn: dc, usdt: du } };
}
