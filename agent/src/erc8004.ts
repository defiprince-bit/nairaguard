/** ERC-8004 identity registration (design.md §6). Pure builders; sending lives in scripts/register-erc8004.ts. */
import { parseAbi } from 'viem';
import { assertTagged, buildContractCall, type TaggedTx } from './txBuilder.js';

/** Celo mainnet Identity Registry. */
export const IDENTITY_REGISTRY_MAINNET = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;

export const identityRegistryAbi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]);

export function agentCardUri(dashboardUrl: string): string {
  return new URL('/.well-known/agent.json', dashboardUrl).toString();
}

/** Tagged register(agentURI) call; throws if the calldata does not end with the attribution tag. */
export function buildRegisterTx(registry: `0x${string}`, agentURI: string): TaggedTx {
  const tx = buildContractCall({ address: registry, abi: identityRegistryAbi, functionName: 'register', args: [agentURI] });
  assertTagged(tx.data);
  return tx;
}

/**
 * Guard before registering: the on-chain agentURI is permanent-ish, so it must live on the production domain
 * (never a *.vercel.app preview/default host) and on the same host as DASHBOARD_URL.
 */
export function assertAgentUri(agentUri: string, dashboardUrl: string | undefined): void {
  const a = new URL(agentUri);
  if (/vercel\.app$/i.test(a.host) || agentUri.toLowerCase().includes('vercel.app')) {
    throw new Error(`agentURI ${agentUri} is on vercel.app; set DASHBOARD_URL/AGENT_URI to the production domain`);
  }
  if (!dashboardUrl) throw new Error('DASHBOARD_URL is required so agentURI can be checked against it');
  const d = new URL(dashboardUrl);
  if (d.host.toLowerCase() !== a.host.toLowerCase()) {
    throw new Error(`agentURI host ${a.host} differs from DASHBOARD_URL host ${d.host}`);
  }
}
