/** Loops House attribution tag. Every transaction must carry it (via the shared tx builder). Not a secret. */
export const ATTRIBUTION_TAG = 'celo_9efd0f97b491' as const;

export const NETWORK = (process.env.NETWORK ?? 'celo-sepolia') as 'celo-sepolia' | 'celo';
export const RPC_URL =
  process.env.RPC_URL ??
  (NETWORK === 'celo' ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');

export type NetworkAddresses = {
  chainId: number;
  /** VaultFactory (Task 8a). Vaults are discovered from its VaultCreated logs. */
  factory: `0x${string}`;
  /** Factory deploy block: first block the log scan reads. */
  factoryStartBlock: bigint;
  cngn: `0x${string}`;
  usdt: `0x${string}`;
  swapRouter: `0x${string}`;
};

/** Deployed addresses per network. celo-sepolia uses mocks (see deployments/celo-sepolia.json). */
export const ADDRESSES: Partial<Record<typeof NETWORK, NetworkAddresses>> = {
  'celo-sepolia': {
    chainId: 11142220,
    factory: (process.env.FACTORY_ADDRESS ?? '0x6C5b2087b321F2eb1cCC2BEA915503bAceD608E1') as `0x${string}`,
    factoryStartBlock: BigInt(process.env.FACTORY_START_BLOCK ?? 38716408),
    cngn: '0xaA3B7364E418deC4Fb147f1BD2d95A4022082aEA',
    usdt: '0xe123971ec3F56138766272B7b15Ee188fdD0eFf7',
    swapRouter: '0xd834aB4e7caDc62f2E27ab6755ED4B22F0461e86',
  },
  // celo mainnet: TBD after mainnet deploy (Task 9)
};

/**
 * SIWE chain for waitlist wallet verification. Separate from NETWORK: users sign in MiniPay on Celo mainnet
 * even while the agent trades on Sepolia. Verification is a read-only call (EIP-1271/6492 smart wallets).
 */
export const WAITLIST_CHAIN_ID = Number(process.env.WAITLIST_CHAIN_ID ?? 42220);
export const WAITLIST_RPC_URL =
  process.env.WAITLIST_RPC_URL ??
  (WAITLIST_CHAIN_ID === 42220 ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');
