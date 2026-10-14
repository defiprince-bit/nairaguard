import { createWalletClient, custom, type Hex } from 'viem';
import { CHAIN } from './overview';
import { tag, type Tx } from './vault';

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

export class WrongChainError extends Error {
  constructor(public got: number, public want: number) {
    super(`Switch to ${want === 42220 ? 'Celo' : 'Celo Sepolia'} in your wallet, then try again.`);
    this.name = 'WrongChainError';
  }
}

/**
 * The single write path for every user transaction (createVault, approve, deposit, withdraw,
 * approve/reject swap) on every connector (MiniPay, injected, WalletConnect).
 * - The ERC-8021 attribution tag is (re)applied here, so no caller can send untagged calldata.
 * - The wallet's chain is asserted here (eth_chainId), and `chain` is passed to viem as a
 *   second guard, so a wrong-network wallet fails instead of sending on another chain.
 *   The UI switch-network screen is a convenience, not the safety check.
 */
export async function sendTagged(eth: Eth, from: `0x${string}`, tx: Tx): Promise<Hex> {
  const got = Number(await eth.request({ method: 'eth_chainId' }));
  if (got !== CHAIN.id) throw new WrongChainError(got, CHAIN.id);
  const wallet = createWalletClient({ account: from, chain: CHAIN, transport: custom(eth) });
  return wallet.sendTransaction({ account: from, chain: CHAIN, to: tx.to, data: tag(tx.data) });
}
