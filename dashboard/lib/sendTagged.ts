import type { Hex } from 'viem';
import { tag, type Tx } from './vault';

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/**
 * The single write path for every user transaction (createVault, approve, deposit, withdraw,
 * approve/reject swap) on every connector (MiniPay, injected, WalletConnect).
 * The ERC-8021 attribution tag is (re)applied here, so no caller can send untagged calldata.
 */
export async function sendTagged(eth: Eth, from: `0x${string}`, tx: Tx): Promise<Hex> {
  return (await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tag(tx.data) }] })) as Hex;
}
