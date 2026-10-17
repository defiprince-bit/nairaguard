import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { createApi, serve } from './api.js';
import { createChainPorts } from './chain.js';
import { ADDRESSES, ATTRIBUTION_TAG, MOCK_MARKET_RATE, NETWORK, RPC_URL, WAITLIST_CHAIN_ID, WAITLIST_RPC_URL } from './config.js';
import { connect, migrate } from './db.js';
import { runOnce } from './loop.js';
import { listVaults, scanFactory, scanFlows } from './factory.js';
import { MockRfqClient, type RfqClient, TextileRfqClient } from './rfq.js';
import { FnRateSource } from './textile.js';

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
    factory: addrs.factory,
    cngn: addrs.cngn,
    usdt: addrs.usdt,
  });
  const sepolia = NETWORK === 'celo-sepolia';
  // Strategy sizing rate: mock market rate on Sepolia; on mainnet the feed rate (the RFQ quote sets the real price).
  const rates = new FnRateSource(async () => {
    if (sepolia) return MOCK_MARKET_RATE;
    const f = await port.readFeed();
    if (!f.rateNgnPerUsd) throw new Error('no reference rate');
    return f.rateNgnPerUsd;
  });
  const decimalsOf = new Map<string, number>();
  for (const t of [addrs.cngn, addrs.usdt]) {
    decimalsOf.set(t.toLowerCase(), Number(await publicClient.readContract({
      address: t, abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
      functionName: 'decimals',
    })));
  }
  if (sepolia && /^0x0+$/.test(addrs.mockReactor ?? '0x0')) throw new Error('MOCK_REACTOR_ADDRESS is required on Sepolia');
  const rfq: RfqClient = sepolia
    ? new MockRfqClient({
        reactor: addrs.mockReactor!, cngn: addrs.cngn, rateNgnPerUsd: () => MOCK_MARKET_RATE,
        decimals: (t) => decimalsOf.get(t.toLowerCase()) ?? 18,
      })
    : new TextileRfqClient(process.env.TEXTILE_API_KEY);
  if (!sepolia && !process.env.TEXTILE_API_KEY) console.warn('TEXTILE_API_KEY not set: every RFQ will be logged as no_quote');
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
    chainId: addrs.chainId, // per-vault views (balances, P&L) read this agent's rows; stats default to 42220
    agentAddress: port.address,
    erc8004Id: process.env.ERC8004_ID,
    tokens: { cngn: addrs.cngn, usdt: addrs.usdt },
    decimals: { cngn: decimalsOf.get(addrs.cngn.toLowerCase()) ?? 18, usdt: decimalsOf.get(addrs.usdt.toLowerCase()) ?? 18 },
    readFeed: () => port.readFeed(),
    readState: async (v) => {
      const known = await listVaults(db, addrs.factory, addrs.chainId);
      if (!known.some((k) => k.vault.toLowerCase() === v.toLowerCase())) throw new Error('unknown vault');
      return port.forVault(v).readState();
    },
    unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET || undefined,
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
    try {
      // Deposits/withdrawals for net-of-flows P&L (backfills from the factory deploy block on first run).
      const f = await scanFlows({
        db, client: publicClient as never, factory: addrs.factory, chainId: addrs.chainId,
        startBlock: addrs.factoryStartBlock, chunk: BigInt(process.env.LOG_CHUNK ?? 5000),
      });
      if (f.flows) console.log(`flows ${f.from}-${f.to}: +${f.flows} deposits/withdrawals`);
    } catch (e) {
      console.error('flow scan failed:', (e as Error).message);
    }
    if (sepolia) {
      // The mock feed only moves when stamped; keep it inside the vault's 1h staleness bound.
      const h = await port.refreshMockFeed(30 * 60).catch((e) => console.error('mock feed refresh failed:', (e as Error).message));
      if (h) console.log(`mock feed re-stamped tx=${h}`);
    }
    const vaults = await listVaults(db, addrs.factory, addrs.chainId).catch(() => []);
    // One vault failing never blocks the others.
    for (const { vault } of vaults) {
      try {
        const r = await runOnce({
          vault, cngn: addrs.cngn, usdt: addrs.usdt, chainId: addrs.chainId, chain: port.forVault(vault), rates, rfq, db,
        });
        console.log(`[${new Date().toISOString()}] ${vault} ${r.decision?.action ?? 'approved'}${r.outcome ? ` rfq=${r.outcome}` : ''}${r.txHash ? ` tx=${r.txHash}` : ''} — ${r.skipped ?? r.decision?.reason ?? ''}`);
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
