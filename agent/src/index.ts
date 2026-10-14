import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { createChainPort } from './chain.js';
import { ADDRESSES, ATTRIBUTION_TAG, NETWORK, RPC_URL } from './config.js';
import { connect, migrate } from './db.js';
import { runOnce } from './loop.js';
import { MockRouterRateSource } from './textile.js';

const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 5 * 60_000);
const ONCE = process.env.RUN_ONCE === '1';

async function main(): Promise<void> {
  if (NETWORK === 'celo' && process.env.ALLOW_MAINNET !== '1') {
    throw new Error('Refusing to run on mainnet without ALLOW_MAINNET=1');
  }
  const addrs = ADDRESSES[NETWORK];
  if (!addrs) throw new Error(`No addresses configured for ${NETWORK}`);
  const pk = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY is required');

  const chain = NETWORK === 'celo' ? celo : celoSepolia;
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const port = createChainPort({
    publicClient: publicClient as never,
    chain,
    rpcUrl: RPC_URL,
    privateKey: pk,
    vault: addrs.vault,
    cngn: addrs.cngn,
    usdt: addrs.usdt,
  });
  const rates = new MockRouterRateSource(publicClient as never, addrs.swapRouter, addrs.usdt, addrs.cngn);
  const db = await connect();
  await migrate(db);

  console.log(`NairaGuard agent ${port.address} on ${NETWORK}, tag ${ATTRIBUTION_TAG}, every ${INTERVAL_MS}ms`);
  const tick = async () => {
    try {
      const r = await runOnce({ vault: addrs.vault, cngn: addrs.cngn, usdt: addrs.usdt, chain: port, rates, db });
      console.log(`[${new Date().toISOString()}] ${r.decision.action}${r.txHash ? ` tx=${r.txHash}` : ''} — ${r.decision.reason}`);
    } catch (e) {
      console.error('tick failed:', (e as Error).message);
    }
  };
  await tick();
  if (ONCE) return;
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
