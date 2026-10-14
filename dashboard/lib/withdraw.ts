import { encodeFunctionData, parseAbi, parseUnits } from 'viem';
import { CHAIN } from './overview';
import { factoryTokens, sendTx, tag, waitForReceipt } from './vault';
import { createPublicClient, http } from 'viem';

export const vaultWithdrawAbi = parseAbi(['function withdraw(address token, uint256 amount, address to)']);

/** Vault.withdraw(token, amount, to) with the ERC-8021 attribution suffix. */
export function buildWithdraw(vault: `0x${string}`, token: `0x${string}`, amount: bigint, to: `0x${string}`) {
  return { to: vault, data: tag(encodeFunctionData({ abi: vaultWithdrawAbi, functionName: 'withdraw', args: [token, amount, to] })) };
}

const decAbi = parseAbi(['function decimals() view returns (uint8)']);

export async function sendWithdraw(owner: `0x${string}`, factory: `0x${string}`, vault: `0x${string}`, which: 'cngn' | 'usdt', amount: string) {
  const eth = window.ethereum;
  if (!eth) throw new Error('No wallet found.');
  const tokens = await factoryTokens(eth, factory);
  const token = tokens[which];
  const pc = createPublicClient({ chain: CHAIN, transport: http() });
  const decimals = await pc.readContract({ address: token, abi: decAbi, functionName: 'decimals' });
  let units: bigint;
  try { units = parseUnits(amount, decimals); } catch { throw new Error('Enter a valid amount.'); }
  if (units <= 0n) throw new Error('Enter an amount above zero.');
  const hash = await sendTx(eth, owner, buildWithdraw(vault, token, units, owner));
  const rc = await waitForReceipt(eth, hash);
  if (rc.status !== '0x1') throw new Error('Withdrawal failed on-chain.');
  return hash;
}
