/**
 * Read-only verification of a deployed VaultFactory. Sends nothing. Exits 1 on any mismatch.
 *   pnpm verify:deploy --factory 0x… --from-block <deployBlock>                    # mainnet (RPC_URL or forno)
 *   pnpm verify:deploy --factory 0x… --from-block <deployBlock> --after-transfer   # after owner acceptOwnership
 *   pnpm verify:deploy --network celo-sepolia                                      # smoke test, relaxed expectations
 * Sepolia mode: tokens/feed/venues come from deployments/celo-sepolia.json, no feed-age check, mock venue allowed.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, parseAbiItem, type Address } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { MAINNET_EXPECT, checkDeploy, type Expect, type VenueEvent } from '../src/verifyDeploy.js';

const flag = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const sepolia = (flag('--network') ?? 'celo') === 'celo-sepolia';
const afterTransfer = process.argv.includes('--after-transfer');

const dep = sepolia ? JSON.parse(readFileSync(new URL('../../deployments/celo-sepolia.json', import.meta.url), 'utf8')) : undefined;
const factory = (flag('--factory') ?? dep?.contracts.VaultFactory) as Address | undefined;
if (!factory) throw new Error('--factory 0x… required');
const fromBlock = BigInt(flag('--from-block') ?? dep?.factoryDeployBlock ?? (() => { throw new Error('--from-block <factory deploy block> required'); })());

const expect: Expect = sepolia
  ? {
      cngn: dep.contracts.MockCNGN, usdt: dep.contracts.MockUSDT, priceFeed: dep.contracts.MockChainlinkFeed,
      agent: dep.agent, owner: dep.owner, decimals: 6, venues: dep.venues,
    }
  : { ...MAINNET_EXPECT, venues: [...MAINNET_EXPECT.venues] };

const chain = sepolia ? celoSepolia : celo;
const client = createPublicClient({ chain, transport: http(process.env.RPC_URL ?? chain.rpcUrls.default.http[0]) });
const fAbi = parseAbi([
  'function cNGN() view returns (address)', 'function usdt() view returns (address)', 'function agent() view returns (address)',
  'function owner() view returns (address)', 'function pendingOwner() view returns (address)',
  'function oracleConfig() view returns ((address feed, uint32 maxFeedAge, uint16 maxDeviationBps, bool fallbackEnabled, uint8 fallbackDecimals, uint32 fallbackMaxAge, uint64 fallbackSetAt, uint256 fallbackRate))',
]);
const erc20 = parseAbi(['function decimals() view returns (uint8)']);
const feedAbi = parseAbi(['function latestRoundData() view returns (uint80, int256, uint256, uint256 updatedAt, uint80)']);
const venueEv = parseAbiItem('event VenueUpdated(address indexed target, address indexed spender, bool allowed, string label)');

const r = <T>(functionName: string, address: Address = factory, abi: unknown = fAbi) =>
  client.readContract({ address, abi: abi as never, functionName } as never) as Promise<T>;

const [actualChain, cngn, usdt, agent, owner, pendingOwner, oracle] = await Promise.all([
  client.getChainId(), r<Address>('cNGN'), r<Address>('usdt'), r<Address>('agent'), r<Address>('owner'),
  r<Address>('pendingOwner'), r<{ feed: Address }>('oracleConfig'),
]);
if (actualChain !== chain.id) throw new Error(`RPC is chain ${actualChain}, expected ${chain.id}`);
const [cngnDecimals, usdtDecimals, round, head] = await Promise.all([
  r<number>('decimals', cngn, erc20), r<number>('decimals', usdt, erc20),
  r<readonly [bigint, bigint, bigint, bigint, bigint]>('latestRoundData', oracle.feed, feedAbi), client.getBlock(),
]);

const venueEvents: VenueEvent[] = [];
const STEP = 50_000n;
for (let b = fromBlock; b <= head.number; b += STEP) {
  const to = b + STEP - 1n > head.number ? head.number : b + STEP - 1n;
  const logs = await client.getLogs({ address: factory, event: venueEv, fromBlock: b, toBlock: to });
  for (const l of logs) venueEvents.push({ target: l.args.target!, spender: l.args.spender!, allowed: l.args.allowed!, label: l.args.label! });
}

const fails = checkDeploy({
  cngn, usdt, cngnDecimals: Number(cngnDecimals), usdtDecimals: Number(usdtDecimals), priceFeed: oracle.feed,
  feedUpdatedAt: Number(round[3]), nowSec: Number(head.timestamp), venueEvents, agent, owner, pendingOwner,
}, expect, afterTransfer);

console.log(`factory ${factory} on ${chain.name} (${sepolia ? 'Sepolia smoke test, relaxed' : 'mainnet, strict'})`);
console.log(`  cNGN ${cngn} (${cngnDecimals}dp)  USDT ${usdt} (${usdtDecimals}dp)  feed ${oracle.feed} updated ${Number(head.timestamp - round[3])}s ago`);
console.log(`  venue events: ${venueEvents.length}  agent ${agent}  owner ${owner}  pendingOwner ${pendingOwner}`);
if (fails.length) {
  console.error(`\n✗ VERIFY FAILED (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ all checks passed${afterTransfer ? ' (incl. ownership)' : ''}`);
