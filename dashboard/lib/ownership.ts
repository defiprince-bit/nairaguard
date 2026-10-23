import { createPublicClient, createWalletClient, custom, encodeFunctionData, http, parseAbi, type Hex } from 'viem';
import { celo } from 'viem/chains';
import { tag, type Tx } from './vault';
import { WrongChainError } from './sendTagged';

/** Celo mainnet VaultFactory (deployed 2026-10, see docs). Independent of the app's default network. */
export const MAINNET_FACTORY = '0xfe37fbea39ce656d7f8181e946e723b7b0d8cecb' as const;
export const ownableAbi = parseAbi([
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function acceptOwnership()',
]);

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Public Forno client for Celo mainnet (no API key in the browser). */
export const mainnetClient = () => createPublicClient({ chain: celo, transport: http() });

export function buildAcceptOwnership(factory: `0x${string}` = MAINNET_FACTORY): Tx {
  return { to: factory, data: tag(encodeFunctionData({ abi: ownableAbi, functionName: 'acceptOwnership' })) };
}

export async function readPendingOwner(): Promise<`0x${string}`> {
  return mainnetClient().readContract({ address: MAINNET_FACTORY, abi: ownableAbi, functionName: 'pendingOwner' });
}

/** Same write path as sendTagged (tagged calldata, chain asserted, no fee fields so MiniPay picks feeCurrency), pinned to Celo mainnet. */
export async function sendAcceptOwnership(eth: Eth, from: `0x${string}`): Promise<Hex> {
  const got = Number(await eth.request({ method: 'eth_chainId' }));
  if (got !== celo.id) throw new WrongChainError(got, celo.id);
  const tx = buildAcceptOwnership();
  const wallet = createWalletClient({ account: from, chain: celo, transport: custom(eth) });
  return wallet.sendTransaction({ account: from, chain: celo, to: tx.to, data: tag(tx.data) });
}

export async function waitMainnet(hash: Hex): Promise<boolean> {
  const rc = await mainnetClient().waitForTransactionReceipt({ hash, timeout: 120_000 });
  return rc.status === 'success';
}
