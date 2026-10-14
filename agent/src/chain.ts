import { type Chain, type PublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainPort, VaultState } from './loop.js';
import { createTxSender } from './txBuilder.js';
import { erc20Abi, vaultAbi } from './vaultAbi.js';

/** viem-backed ChainPort. All sends go through the tagged txBuilder. */
export function createChainPort(opts: {
  publicClient: PublicClient;
  chain: Chain;
  rpcUrl: string;
  privateKey: `0x${string}`;
  vault: `0x${string}`;
  cngn: `0x${string}`;
  usdt: `0x${string}`;
}): ChainPort & { address: `0x${string}` } {
  const { publicClient: pc, vault } = opts;
  const sender = createTxSender({
    account: privateKeyToAccount(opts.privateKey),
    chain: opts.chain,
    transport: http(opts.rpcUrl),
  });
  return {
    address: sender.address,
    async readState(): Promise<VaultState> {
      const [ngn, usd, lim, spent, dayStart, paused] = await Promise.all([
        pc.readContract({ address: opts.cngn, abi: erc20Abi, functionName: 'balanceOf', args: [vault] }),
        pc.readContract({ address: opts.usdt, abi: erc20Abi, functionName: 'balanceOf', args: [vault] }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'limits' }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'dailySpentUsd' }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'dayStart' }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'paused' }),
      ]);
      return {
        ngnBalance: ngn,
        usdBalance: usd,
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
  };
}
