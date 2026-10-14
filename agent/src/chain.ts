import { type Chain, type PublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { feedAbi, type FeedReading, interpretFeed } from './feed.js';
import type { ChainPort, VaultState } from './loop.js';
import { buildContractCall, createTxSender } from './txBuilder.js';
import { erc20Abi, factoryAbi, mockFeedAbi, vaultAbi } from './vaultAbi.js';

type PortOpts = {
  publicClient: PublicClient;
  chain: Chain;
  rpcUrl: string;
  privateKey: `0x${string}`;
  factory: `0x${string}`;
  cngn: `0x${string}`;
  usdt: `0x${string}`;
};

export type ChainPorts = {
  address: `0x${string}`;
  forVault(v: `0x${string}`): ChainPort;
  /** Reference rate as the vault sees it (feed, or the owner's fallback when switched on). */
  readFeed(): Promise<FeedReading>;
  /** Sepolia only: re-stamp the mock feed when it's older than `maxAgeSec` and the agent owns it. */
  refreshMockFeed(maxAgeSec: number): Promise<`0x${string}` | undefined>;
};

/** One agent signer shared by every vault; `forVault` gives a per-vault ChainPort. */
export function createChainPorts(opts: PortOpts): ChainPorts {
  const sender = createTxSender({
    account: privateKeyToAccount(opts.privateKey),
    chain: opts.chain,
    transport: http(opts.rpcUrl),
  });
  const pc = opts.publicClient;
  const decCache = new Map<string, number>();
  const decimals = async (t: `0x${string}`) => {
    const k = t.toLowerCase();
    if (!decCache.has(k)) decCache.set(k, Number(await pc.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' })));
    return decCache.get(k)!;
  };
  const oracle = () => pc.readContract({ address: opts.factory, abi: factoryAbi, functionName: 'oracleConfig' });

  async function readFeed(): Promise<FeedReading> {
    const c = await oracle();
    const now = new Date();
    if (c.fallbackEnabled) {
      const r = interpretFeed(c.fallbackRate, c.fallbackDecimals, c.fallbackSetAt, now, Number(c.fallbackMaxAge));
      return r;
    }
    const [dec, round] = await Promise.all([
      pc.readContract({ address: c.feed, abi: feedAbi, functionName: 'decimals' }),
      pc.readContract({ address: c.feed, abi: feedAbi, functionName: 'latestRoundData' }),
    ]);
    return interpretFeed(round[1], Number(dec), round[3], now, Number(c.maxFeedAge));
  }

  async function refreshMockFeed(maxAgeSec: number) {
    const c = await oracle();
    const owner = await pc.readContract({ address: c.feed, abi: mockFeedAbi, functionName: 'owner' }).catch(() => undefined);
    if (!owner || owner.toLowerCase() !== sender.address.toLowerCase()) return undefined;
    const round = await pc.readContract({ address: c.feed, abi: feedAbi, functionName: 'latestRoundData' });
    if (Date.now() / 1000 - Number(round[3]) < maxAgeSec) return undefined;
    const hash = await sender.send(buildContractCall({ address: c.feed, abi: mockFeedAbi, functionName: 'setAnswer', args: [round[1]] }));
    await pc.waitForTransactionReceipt({ hash });
    return hash;
  }

  return {
    address: sender.address,
    readFeed,
    refreshMockFeed,
    forVault: (vault) => portFor(opts, sender, vault, decimals, readFeed),
  };
}

function portFor(
  opts: PortOpts,
  sender: ReturnType<typeof createTxSender>,
  vault: `0x${string}`,
  decimals: (t: `0x${string}`) => Promise<number>,
  readFeed: () => Promise<FeedReading>,
): ChainPort {
  const pc = opts.publicClient;
  return {
    async readState(): Promise<VaultState> {
      const [ngn, usd, lim, spent, dayStart, paused, ngnDecimals, usdDecimals] = await Promise.all([
        pc.readContract({ address: opts.cngn, abi: erc20Abi, functionName: 'balanceOf', args: [vault] }),
        pc.readContract({ address: opts.usdt, abi: erc20Abi, functionName: 'balanceOf', args: [vault] }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'limits' }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'dailySpentUsd' }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'dayStart' }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'paused' }),
        decimals(opts.cngn),
        decimals(opts.usdt),
      ]);
      return {
        ngnBalance: ngn,
        usdBalance: usd,
        ngnDecimals,
        usdDecimals,
        limits: {
          maxTradeUsd: lim[0],
          maxDailyUsd: lim[1],
          approvalThresholdUsd: lim[2],
          maxSlippageBps: lim[3],
          targetNgnBps: lim[4],
        },
        dailySpentUsd: spent,
        dayStart,
        paused,
      };
    },
    async send(tx) {
      const hash = await sender.send(tx);
      const rc = await pc.waitForTransactionReceipt({ hash });
      return { hash, status: rc.status, logs: rc.logs };
    },
    readFeed,
    minOutFloor: (tokenIn, tokenOut, amountIn) =>
      pc.readContract({ address: vault, abi: vaultAbi, functionName: 'minOutFloor', args: [tokenIn, tokenOut, amountIn] }),
    isAllowedVenue: (target, spender) =>
      pc.readContract({ address: opts.factory, abi: factoryAbi, functionName: 'isAllowedVenue', args: [target, spender] }),
    venueLabel: (target) =>
      pc.readContract({ address: opts.factory, abi: factoryAbi, functionName: 'venueLabelOf', args: [target] }),
  };
}
