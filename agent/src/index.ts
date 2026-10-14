import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { ATTRIBUTION_TAG, NETWORK, RPC_URL } from './config.js';

const client = createPublicClient({
  chain: NETWORK === 'celo' ? celo : celoSepolia,
  transport: http(RPC_URL),
});

async function main(): Promise<void> {
  // Placeholder agent loop: read rate & balances -> decide -> explain -> submit via tx builder.
  console.log(`NairaGuard agent starting on ${NETWORK} (tag ${ATTRIBUTION_TAG})`);
  const block = await client.getBlockNumber();
  console.log(`Latest block: ${block}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
