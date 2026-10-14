/**
 * Tagged deploy of Vault implementation + VaultFactory (+ optional setRouter) via viem.
 * Creation bytecode = forge artifact + constructor args + ERC-8021 suffix (celo_9efd0f97b491).
 *   (cd ../contracts && forge build)                                       # artifacts in contracts/out
 *   pnpm tsx scripts/deploy-mainnet.ts                                    # dry run: builds + checks tags, sends nothing
 *   NETWORK=celo ALLOW_MAINNET=1 DEPLOYER_PRIVATE_KEY=... AGENT_ADDRESS=... CNGN_ADDRESS=... USDT_ADDRESS=... \
 *     [TEXTILE_ROUTER=...] pnpm tsx scripts/deploy-mainnet.ts --send       # owner-approved only
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
const router = process.env.TEXTILE_ROUTER ? getAddress(process.env.TEXTILE_ROUTER) : undefined;

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
if (router) {
  const hash = await sender.send(buildContractCall({ address: fac, abi: factory.abi, functionName: 'setRouter', args: [router, true] } as never));
  console.log(`setRouter ${router} tx=${hash} status=${(await pc.waitForTransactionReceipt({ hash })).status}`);
}
