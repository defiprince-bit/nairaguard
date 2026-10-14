/**
 * Tagged deploy of Vault implementation + VaultFactory, then setPriceFeed + Textile venue pairs, via viem.
 * Creation bytecode = forge artifact + constructor args + ERC-8021 suffix (celo_9efd0f97b491).
 *   (cd ../contracts && forge build)                                       # artifacts in contracts/out
 *   pnpm tsx scripts/deploy-mainnet.ts                                    # dry run: builds + checks tags, sends nothing
 *   NETWORK=celo ALLOW_MAINNET=1 DEPLOYER_PRIVATE_KEY=... AGENT_ADDRESS=... CNGN_ADDRESS=... USDT_ADDRESS=... \
 *     pnpm tsx scripts/deploy-mainnet.ts --send                          # owner-approved only
 * After deploy: factory.transferOwnership(owner) → owner acceptOwnership.
 */
import { readFileSync } from 'node:fs';
import { type Abi, type Hex, createPublicClient, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, celoSepolia } from 'viem/chains';
import { NETWORK, RPC_URL } from '../src/config.js';
import { assertTagged, buildContractCall, buildDeploy, createTxSender } from '../src/txBuilder.js';

const send = process.argv.includes('--send');
const art = (name: string) => {
  const j = JSON.parse(readFileSync(new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};
const env = (k: string, dflt?: string) => {
  const v = process.env[k] ?? dflt;
  if (!v) throw new Error(`${k} required`);
  return getAddress(v);
};
const PLACEHOLDER = '0x0000000000000000000000000000000000000001';
const agent = env('AGENT_ADDRESS', send ? undefined : '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4');
const cngn = env('CNGN_ADDRESS', send ? undefined : PLACEHOLDER);
const usdt = env('USDT_ADDRESS', send ? undefined : PLACEHOLDER);
// design.md §8: Chainlink NGN/USD + Textile (target, spender) pairs. Never Permit2.
const PRICE_FEED = env('PRICE_FEED', '0xc17cbe2db40e53f4984c46f608da6da1ff074c11');
const VENUES: [Hex, Hex, string][] = [
  ['0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3', '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3', 'textile'], // LimitOrderReactor
  ['0x01b006d5c687bde182aa36F542f1f014144742e2', '0x01b006d5c687bde182aa36F542f1f014144742e2', 'textile'], // VaultOrderExecutor
];

const vault = art('Vault');
const factory = art('VaultFactory');
const implTx = buildDeploy({ abi: vault.abi, bytecode: vault.bytecode });
assertTagged(implTx.data);
console.log(JSON.stringify({ dryRun: !send, network: NETWORK, implementationInitcodeBytes: (implTx.data.length - 2) / 2, tagged: true }));
if (!send) {
  const f = buildDeploy({ abi: factory.abi, bytecode: factory.bytecode, args: [PLACEHOLDER, agent, cngn, usdt] });
  assertTagged(f.data);
  console.log(JSON.stringify({ factoryInitcodeBytes: (f.data.length - 2) / 2, tagged: true }));
  process.exit(0);
}

if (NETWORK === 'celo' && process.env.ALLOW_MAINNET !== '1') throw new Error('mainnet needs ALLOW_MAINNET=1 (owner approval)');
const chain = NETWORK === 'celo' ? celo : celoSepolia;
const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY required');
const sender = createTxSender({ account: privateKeyToAccount(pk), chain, transport: http(RPC_URL) });
const pc = createPublicClient({ chain, transport: http(RPC_URL) });

const created = async (label: string, data: Hex) => {
  const hash = await sender.deploy({ data });
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success' || !rc.contractAddress) throw new Error(`${label} failed: ${hash}`);
  console.log(`${label} ${rc.contractAddress} tx=${hash} block=${rc.blockNumber}`);
  return rc.contractAddress;
};
const impl = await created('VaultImplementation', implTx.data);
const fac = await created('VaultFactory', buildDeploy({ abi: factory.abi, bytecode: factory.bytecode, args: [impl, agent, cngn, usdt] }).data);
const call = async (label: string, functionName: string, args: unknown[]) => {
  const hash = await sender.send(buildContractCall({ address: fac, abi: factory.abi, functionName, args } as never));
  console.log(`${label} tx=${hash} status=${(await pc.waitForTransactionReceipt({ hash })).status}`);
};
await call(`setPriceFeed ${PRICE_FEED}`, 'setPriceFeed', [PRICE_FEED]);
for (const [t, sp, label] of VENUES) await call(`setVenue ${t} ${sp} ${label}`, 'setVenue', [t, sp, true, label]);
