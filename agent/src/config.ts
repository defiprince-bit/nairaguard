/** Loops House attribution tag. Every transaction must carry it (via the shared tx builder). Not a secret. */
export const ATTRIBUTION_TAG = 'celo_9efd0f97b491' as const;

export const NETWORK = (process.env.NETWORK ?? 'alfajores') as 'alfajores' | 'celo';
export const RPC_URL =
  process.env.RPC_URL ??
  (NETWORK === 'celo' ? 'https://forno.celo.org' : 'https://alfajores-forno.celo-testnet.org');
