/**
 * One-off Celo Sepolia setup (testnet only). Run as the vault owner (deployer):
 *   NETWORK=celo-sepolia DEPLOYER_PRIVATE_KEY=... pnpm tsx scripts/seed-sepolia.ts
 * Fixes mock router rates (1 USD₮ = ₦1,500), deposits mock cNGN/USD₮, sets limits,
 * and tops up the agent with testnet CELO. All txs go through the tagged txBuilder.
 */
import { createPublicClient, http, parseEther, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celoSepolia } from 'viem/chains';
import { ADDRESSES, NETWORK, RPC_URL } from '../src/config.js';
import { buildContractCall, buildTransfer, createTxSender } from '../src/txBuilder.js';
import { erc20Abi, mockRouterAbi, vaultAbi } from '../src/vaultAbi.js';

if (NETWORK !== 'celo-sepolia') throw new Error('seed-sepolia is testnet only');
const a = ADDRESSES['celo-sepolia']!;
const AGENT = (process.env.AGENT_ADDRESS ?? '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4') as `0x${string}`;
const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`;
if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY required');

const pc = createPublicClient({ chain: celoSepolia, transport: http(RPC_URL) });
const sender = createTxSender({ account: privateKeyToAccount(pk), chain: celoSepolia, transport: http(RPC_URL) });
const e18 = (n: string) => parseUnits(n, 18);

async function send(label: string, tx: Parameters<typeof sender.send>[0]) {
  const hash = await sender.send(tx);
  const rc = await pc.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${rc.status} ${hash}`);
  if (rc.status !== 'success') throw new Error(`${label} reverted`);
}

const c = (address: `0x${string}`, abi: any, functionName: string, args: unknown[]) =>
  buildContractCall({ address, abi, functionName, args } as never);

await send('router rate cNGN', c(a.swapRouter, mockRouterAbi, 'setRate', [a.cngn, e18('1500')]));
await send('router rate USDT', c(a.swapRouter, mockRouterAbi, 'setRate', [a.usdt, e18('1')]));
await send('mint cNGN', c(a.cngn, erc20Abi, 'mint', [sender.address, e18('300000')]));
await send('mint USDT', c(a.usdt, erc20Abi, 'mint', [sender.address, e18('100')]));
await send('approve cNGN', c(a.cngn, erc20Abi, 'approve', [a.vault, e18('300000')]));
await send('approve USDT', c(a.usdt, erc20Abi, 'approve', [a.vault, e18('100')]));
await send('deposit cNGN', c(a.vault, vaultAbi, 'deposit', [a.cngn, e18('300000')]));
await send('deposit USDT', c(a.vault, vaultAbi, 'deposit', [a.usdt, e18('100')]));
await send(
  'setLimits',
  c(a.vault, vaultAbi, 'setLimits', [
    { maxTradeUsd: e18('100'), maxDailyUsd: e18('500'), approvalThresholdUsd: e18('100'), maxSlippageBps: 100, targetNgnBps: 5000 },
  ]),
);
const bal = await pc.getBalance({ address: AGENT });
if (bal < parseEther('0.1')) await send('fund agent CELO', buildTransfer(AGENT, parseEther('0.5')));
console.log('seed done');
