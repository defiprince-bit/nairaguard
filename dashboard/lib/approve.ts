import { createWalletClient, custom, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { CHAIN } from './overview';
import { tag, waitForReceipt } from './vault';

export const vaultApprovalAbi = parseAbi(['function approve(uint256 id) returns (uint256 amountOut)']);

/** Owner executes a proposed swap: Vault.approve(id), with the ERC-8021 attribution suffix. */
export function buildApproveSwap(vault: `0x${string}`, id: bigint) {
  return { to: vault, data: tag(encodeFunctionData({ abi: vaultApprovalAbi, functionName: 'approve', args: [id] })) };
}

export async function sendApproveSwap(owner: `0x${string}`, vault: `0x${string}`, id: bigint): Promise<Hex> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No wallet found.');
  const wallet = createWalletClient({ account: owner, chain: CHAIN, transport: custom(eth) });
  const tx = buildApproveSwap(vault, id);
  const hash = await wallet.sendTransaction({ account: owner, chain: CHAIN, to: tx.to, data: tx.data });
  const rc = await waitForReceipt(eth, hash);
  if (rc.status !== '0x1') throw new Error('Transaction failed on-chain.');
  return hash;
}
