import { NextResponse } from 'next/server';

// ERC-8004 agent card (design.md §6). Must be live before `register(agentURI)`.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nairaguard-vert.vercel.app';
const AGENT = '0xa2a173a481bc063fee0ef11c67fc756dc5f928f4';

export const dynamic = 'force-static';

export function GET() {
  const agentId = process.env.ERC8004_AGENT_ID; // set after registration
  return NextResponse.json(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'NairaGuard',
      description:
        'AI agent on Celo that protects naira savings by rebalancing cNGN and USD₮ via Textile inside a user-owned vault with on-chain limits. Runs as a MiniPay mini app.',
      image: `${SITE}/icon.png`,
      endpoints: [
        { name: 'web', endpoint: SITE },
        { name: 'wallet', endpoint: AGENT, chainId: 42220 },
      ],
      ...(agentId ? { registrations: [{ agentId: Number(agentId), agentRegistry: 'eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' }] } : {}),
      supportedTrust: ['reputation'],
    },
    { headers: { 'access-control-allow-origin': '*' } },
  );
}
