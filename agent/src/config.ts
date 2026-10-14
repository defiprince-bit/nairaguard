/** Loops House attribution tag. Every transaction must carry it (via the shared tx builder). Not a secret. */
export const ATTRIBUTION_TAG = 'celo_9efd0f97b491' as const;

export const NETWORK = (process.env.NETWORK ?? 'celo-sepolia') as 'celo-sepolia' | 'celo';
export const RPC_URL =
  process.env.RPC_URL ??
  (NETWORK === 'celo' ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');

export type NetworkAddresses = {
  chainId: number;
  vault: `0x${string}`;
  cngn: `0x${string}`;
  usdt: `0x${string}`;
  swapRouter: `0x${string}`;
};

/** Deployed addresses per network. celo-sepolia uses mocks (see deployments/celo-sepolia.json). */
export const ADDRESSES: Partial<Record<typeof NETWORK, NetworkAddresses>> = {
  'celo-sepolia': {
    chainId: 11142220,
    vault: '0xA47F3e8b08a94D1933e2031416d54640A0BEF63B',
    cngn: '0xfe37fbEA39ce656d7f8181e946E723b7b0D8cecB',
    usdt: '0x65F5245b352EfE3ed15EdfE20efc8222107efC3c',
    swapRouter: '0xa2859541D2d464e23ad0c07a944a96ad191E2eF2',
  },
  // celo mainnet: TBD after mainnet deploy (Task 9)
};
