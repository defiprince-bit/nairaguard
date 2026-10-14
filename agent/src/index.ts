import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { createApi, serve } from './api.js';
import { createChainPorts } from './chain.js';
import { ADDRESSES, ATTRIBUTION_TAG, NETWORK, RPC_URL, WAITLIST_CHAIN_ID, WAITLIST_RPC_URL } from './config.js';
import { connect, migrate } from './db.js';
import { runOnce } from './loop.js';
import { listVaults, scanFactory } from './factory.js';
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
  if (/^0x0+$/.test(addrs.factory)) throw new Error('FACTORY_ADDRESS is required');
  const port = createChainPorts({
    publicClient: publicClient as never,
    chain,
    rpcUrl: RPC_URL,
    privateKey: pk,
    cngn: addrs.cngn,
    usdt: addrs.usdt,
  });
  const rates = new MockRouterRateSource(publicClient as never, addrs.swapRouter, addrs.usdt, addrs.cngn);
  const db = await connect();
  await migrate(db);

  const apiPort = Number(process.env.PORT ?? 8080);
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://nairaguard-vert.vercel.app';
  // Read-only client for SIWE checks on the waitlist chain (default Celo mainnet). Never sends txs.
  const siweClient = createPublicClient({
    chain: WAITLIST_CHAIN_ID === 42220 ? celo : celoSepolia,
    transport: http(WAITLIST_RPC_URL),
  });
  const api = createApi({
    db,
    agentAddress: port.address,
    erc8004Id: process.env.ERC8004_ID,
    tokens: { cngn: addrs.cngn, usdt: addrs.usdt },
    readState: async (v) => {
      const known = await listVaults(db, addrs.factory, addrs.chainId);
      if (!known.some((k) => k.vault.toLowerCase() === v.toLowerCase())) throw new Error('unknown vault');
      return port.forVault(v).readState();
    },
    siwe: { domain: new URL(dashboardUrl).host, uri: dashboardUrl, chainId: WAITLIST_CHAIN_ID, client: siweClient as never },
  });
  if (!ONCE) serve(api, apiPort, dashboardUrl);

  console.log(`NairaGuard agent ${port.address} on ${NETWORK}, tag ${ATTRIBUTION_TAG}, every ${INTERVAL_MS}ms`);
  const tick = async () => {
    try {
      const s = await scanFactory({
        db, client: publicClient as never, factory: addrs.factory, chainId: addrs.chainId,
        startBlock: addrs.factoryStartBlock, chunk: BigInt(process.env.LOG_CHUNK ?? 5000),
      });
      if (s.created || s.deposits) console.log(`scan ${s.from}-${s.to}: +${s.created} vaults, +${s.deposits} first deposits`);
    } catch (e) {
      console.error('factory scan failed:', (e as Error).message);
    }
    const vaults = await listVaults(db, addrs.factory, addrs.chainId).catch(() => []);
    // One vault failing never blocks the others.
    for (const { vault } of vaults) {
      try {
        const r = await runOnce({ vault, cngn: addrs.cngn, usdt: addrs.usdt, chain: port.forVault(vault), rates, db });
        console.log(`[${new Date().toISOString()}] ${vault} ${r.decision.action}${r.txHash ? ` tx=${r.txHash}` : ''} — ${r.decision.reason}`);
      } catch (e) {
        console.error(`tick failed for ${vault}:`, (e as Error).message);
      }
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
