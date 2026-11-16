import { encodeFunctionData, formatUnits, parseAbi, parseUnits } from 'viem';
import { CHAIN } from './overview';
import { factoryTokens, tag, waitForReceipt } from './vault';
import { sendTagged } from './sendTagged';
import { getProvider } from './wallet';
import { createPublicClient, http } from 'viem';

export const vaultWithdrawAbi = parseAbi(['function withdraw(address token, uint256 amount, address to)']);

/** Vault.withdraw(token, amount, to) with the ERC-8021 attribution suffix. */
export function buildWithdraw(vault: `0x${string}`, token: `0x${string}`, amount: bigint, to: `0x${string}`) {
  return { to: vault, data: tag(encodeFunctionData({ abi: vaultWithdrawAbi, functionName: 'withdraw', args: [token, amount, to] })) };
}

const decAbi = parseAbi(['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)']);

export type VaultTokenBalance = { token: `0x${string}`; decimals: number; raw: bigint; display: string };

/** What the vault actually holds of each token, in token units (cNGN and USD₮ are both 6 decimals on Celo). */
export async function readVaultBalances(factory: `0x${string}`, vault: `0x${string}`): Promise<Record<'cngn' | 'usdt', VaultTokenBalance>> {
  const eth = getProvider();
  if (!eth) throw new Error('No wallet found.');
  const tokens = await factoryTokens(eth, factory);
  const pc = createPublicClient({ chain: CHAIN, transport: http() });
  const one = async (token: `0x${string}`): Promise<VaultTokenBalance> => {
    const [decimals, raw] = await Promise.all([
      pc.readContract({ address: token, abi: decAbi, functionName: 'decimals' }),
      pc.readContract({ address: token, abi: decAbi, functionName: 'balanceOf', args: [vault] }) as Promise<bigint>,
    ]);
    return { token, decimals: Number(decimals), raw, display: formatUnits(raw, Number(decimals)) };
  };
  const [cngn, usdt] = await Promise.all([one(tokens.cngn), one(tokens.usdt)]);
  return { cngn, usdt };
}

export async function sendWithdraw(owner: `0x${string}`, factory: `0x${string}`, vault: `0x${string}`, which: 'cngn' | 'usdt', amount: string) {
  const eth = getProvider();
  if (!eth) throw new Error('No wallet found.');
  const tokens = await factoryTokens(eth, factory);
  const token = tokens[which];
  const pc = createPublicClient({ chain: CHAIN, transport: http() });
  const decimals = await pc.readContract({ address: token, abi: decAbi, functionName: 'decimals' });
  let units: bigint;
  try { units = parseUnits(amount, decimals); } catch { throw new Error('Enter a valid amount.'); }
  if (units <= 0n) throw new Error('Enter an amount above zero.');
  const held = (await pc.readContract({ address: token, abi: decAbi, functionName: 'balanceOf', args: [vault] })) as bigint;
  if (units > held) {
    const sym = which === 'cngn' ? 'cNGN' : 'USD₮';
    throw new Error(`Your vault holds ${formatUnits(held, decimals)} ${sym}. Enter that or less (the balance at the top is cNGN and USD₮ added together).`);
  }
  const hash = await sendTagged(eth, owner, buildWithdraw(vault, token, units, owner));
  const rc = await waitForReceipt(eth, hash);
  if (rc.status !== '0x1') throw new Error('Withdrawal failed on-chain.');
  return hash;
}
