/**
 * Register the agent in the ERC-8004 Identity Registry (design.md §6), from the AGENT wallet only.
 *   pnpm tsx scripts/register-erc8004.ts                     # dry run (default): builds + checks the tagged tx, sends nothing
 *   NETWORK=celo ALLOW_MAINNET=1 AGENT_PRIVATE_KEY=... pnpm tsx scripts/register-erc8004.ts --send   # owner-approved only
 * Refuses to send unless calldata ends with the celo_9efd0f97b491 suffix. Agent card must be live first.
 * After sending, set ERC8004_ID=<agentId> on Railway and redeploy.
 */
import { createPublicClient, decodeEventLog, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { ATTRIBUTION_TAG, NETWORK, RPC_URL } from '../src/config.js';
import { agentCardUri, buildRegisterTx, IDENTITY_REGISTRY_MAINNET, identityRegistryAbi } from '../src/erc8004.js';
import { assertTagged, createTxSender } from '../src/txBuilder.js';

const AGENT = '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4';
const send = process.argv.includes('--send');
const registry = (process.env.IDENTITY_REGISTRY ?? IDENTITY_REGISTRY_MAINNET) as `0x${string}`;
const uri = process.env.AGENT_URI ?? agentCardUri(process.env.DASHBOARD_URL ?? 'https://nairaguard-vert.vercel.app');

const tx = buildRegisterTx(registry, uri);
console.log(JSON.stringify({ dryRun: !send, registry, agentURI: uri, tag: ATTRIBUTION_TAG, tagged: true, to: tx.to, data: tx.data }, null, 2));

const card = await fetch(uri).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!card) console.error(`warning: agent card not reachable at ${uri}`);
if (!send) process.exit(0);

if (NETWORK !== 'celo' || process.env.ALLOW_MAINNET !== '1') throw new Error('--send needs NETWORK=celo and ALLOW_MAINNET=1 (owner approval)');
if (!card) throw new Error('agent card must be live before registering');
const pk = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error('AGENT_PRIVATE_KEY required');
const account = privateKeyToAccount(pk);
if (account.address.toLowerCase() !== AGENT.toLowerCase()) throw new Error('must register from the agent wallet');

assertTagged(tx.data);
const sender = createTxSender({ account, chain: celo, transport: http(RPC_URL) });
const hash = await sender.send(tx);
const rc = await createPublicClient({ chain: celo, transport: http(RPC_URL) }).waitForTransactionReceipt({ hash });
for (const log of rc.logs) {
  try {
    const ev = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics });
    if (ev.eventName === 'Registered') console.log(`registered agentId=${ev.args.agentId} tx=${hash}`);
  } catch { /* other log */ }
}
console.log(`status=${rc.status} tx=${hash}`);
