import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import { sendTagged } from './sendTagged';
import { getProvider } from './wallet';
import { tag, waitForReceipt } from './vault';

export const vaultApprovalAbi = parseAbi(['function approve(uint256 id) returns (uint64 expiresAt)']);

/** Owner approves a proposed swap: Vault.approve(id) opens a 30-min window for the agent (Task 8b). Tagged. */
export function buildApproveSwap(vault: `0x${string}`, id: bigint) {
  return { to: vault, data: tag(encodeFunctionData({ abi: vaultApprovalAbi, functionName: 'approve', args: [id] })) };
}

export async function sendApproveSwap(owner: `0x${string}`, vault: `0x${string}`, id: bigint): Promise<Hex> {
  const eth = getProvider();
  if (!eth) throw new Error('No wallet found.');
  const tx = buildApproveSwap(vault, id);
  const hash = await sendTagged(eth, owner, tx);
  const rc = await waitForReceipt(eth, hash);
  if (rc.status !== '0x1') throw new Error('Transaction failed on-chain.');
  return hash;
}

/** From contracts/src/Vault.sol: `function reject(uint256 id) external onlyOwner` (emits SwapRejected). */
export const vaultRejectAbi = parseAbi(['function reject(uint256 id)']);

export function buildRejectSwap(vault: `0x${string}`, id: bigint) {
  return { to: vault, data: tag(encodeFunctionData({ abi: vaultRejectAbi, functionName: 'reject', args: [id] })) };
}

export async function sendRejectSwap(owner: `0x${string}`, vault: `0x${string}`, id: bigint): Promise<Hex> {
  const eth = getProvider();
  if (!eth) throw new Error('No wallet found.');
  const tx = buildRejectSwap(vault, id);
  const hash = await sendTagged(eth, owner, tx);
  const rc = await waitForReceipt(eth, hash);
  if (rc.status !== '0x1') throw new Error('Transaction failed on-chain.');
  return hash;
}

export const REJECT_HELPER = 'Got it. The agent won\u2019t suggest this again for about 6 hours unless the naira moves a lot.';
