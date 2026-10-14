import { type PublicClient, parseAbi } from 'viem';

export const feedAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

/** Chainlink NGN/USD (USD per 1 NGN). Celo mainnet. */
export const CHAINLINK_NGN_USD_CELO = '0xc17cbe2db40e53f4984c46f608da6da1ff074c11' as const;

export type FeedReading = {
  /** ₦ per $1 (inverse of the feed answer). Null if the answer is ≤ 0. */
  rateNgnPerUsd: number | null;
  answer: bigint;
  decimals: number;
  updatedAt: Date;
  /** Older than maxAgeSec, or answer ≤ 0: the vault would revert StalePrice/BadPrice. */
  stale: boolean;
};

export function interpretFeed(answer: bigint, decimals: number, updatedAtSec: bigint, now: Date, maxAgeSec = 3600): FeedReading {
  const updatedAt = new Date(Number(updatedAtSec) * 1000);
  const ok = answer > 0n;
  const rate = ok ? 10 ** decimals / Number(answer) : null;
  const age = (now.getTime() - updatedAt.getTime()) / 1000;
  return { rateNgnPerUsd: rate, answer, decimals, updatedAt, stale: !ok || age > maxAgeSec };
}

/** Reads the feed. Decimals come from the feed, never assumed. */
export async function readFeed(client: PublicClient, feed: `0x${string}`, now = new Date(), maxAgeSec = 3600): Promise<FeedReading> {
  const [dec, round] = await Promise.all([
    client.readContract({ address: feed, abi: feedAbi, functionName: 'decimals' }),
    client.readContract({ address: feed, abi: feedAbi, functionName: 'latestRoundData' }),
  ]);
  return interpretFeed(round[1], Number(dec), round[3], now, maxAgeSec);
}
