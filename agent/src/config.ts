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
  /** Chainlink NGN/USD (mainnet) or MockChainlinkFeed (Sepolia). The factory's oracleConfig is authoritative. */
  priceFeed: `0x${string}`;
  /** MockTextileReactor on Sepolia; unused on mainnet (Textile quotes name the target). */
  mockReactor?: `0x${string}`;
};

/** Deployed addresses per network. celo-sepolia uses mocks (see deployments/celo-sepolia.json). */
export const ADDRESSES: Partial<Record<typeof NETWORK, NetworkAddresses>> = {
  'celo-sepolia': {
    chainId: 11142220,
    factory: (process.env.FACTORY_ADDRESS ?? '0x7C0aDDFc500De0a2Ce06eBa399c3E55E47E2Aceb') as `0x${string}`,
    factoryStartBlock: BigInt(process.env.FACTORY_START_BLOCK ?? 38723073),
    // Task 8b redeploy (6-dp mocks, mock feed, mock reactor). Env vars override.
    cngn: (process.env.CNGN_ADDRESS ?? '0xFA66cfEd00F4C079926fdC436185A010f1AD3123') as `0x${string}`,
    usdt: (process.env.USDT_ADDRESS ?? '0x6b941732c3B78D9232cd8332b8D3448B4a13beC0') as `0x${string}`,
    priceFeed: (process.env.PRICE_FEED_ADDRESS ?? '0x5EF4E9401d990C57201954472bf9BdB23DCD655d') as `0x${string}`,
    mockReactor: (process.env.MOCK_REACTOR_ADDRESS ?? '0x412e3e068c834758e34f8D5468D6d8DCAddf4DE4') as `0x${string}`,
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

/** Mock market rate (₦ per $1) for Sepolia quotes; the mock feed holds the official rate (~₦1,330). */
export const MOCK_MARKET_RATE = Number(process.env.MOCK_MARKET_RATE ?? 1361);

/** Chain this agent instance trades on. Every stats/count row is tagged with it (migration 011). */
export const AGENT_CHAIN_ID = NETWORK === 'celo' ? 42220 : 11142220;
/** Default chain for stats, user counts and P&L when the caller passes none: always mainnet, never all chains. */
export const STATS_DEFAULT_CHAIN_ID = 42220;
