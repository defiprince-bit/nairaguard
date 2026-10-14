import type { ActivityItem, AgentStatus, ApprovalItem, BalancesResponse, Money } from './types';

const rateAt = new Date(Date.now() - 3 * 60_000).toISOString();
const rate = '1585';

function money(token: Money['token'], amount: string, ngn: string, usd: string): Money {
  return { token, amount, amountNgn: ngn, amountUsd: usd, rate, rateAt };
}

export const mockBalances: BalancesResponse = {
  balances: [
    money('cNGN', '412400000000000000000000', '412400', '260.19'),
    money('USDT', '250000000', '396250', '250.00'),
  ],
  ngnShareBps: 5100,
  targetNgnBps: 5000,
};

export const mockActivity: ActivityItem[] = [
  {
    id: '1',
    kind: 'swap',
    in: money('cNGN', '50000000000000000000000', '50000', '31.55'),
    out: money('USDT', '31500000', '49928', '31.50'),
    reason: 'Naira share drifted to 58%. Moved some into USD₮ to get closer to your 50/50 target.',
    txHash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abcd',
    status: 'confirmed',
    at: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
  {
    id: '2',
    kind: 'swap',
    in: money('USDT', '20000000', '31700', '20.00'),
    out: money('cNGN', '31650000000000000000000', '31650', '19.97'),
    reason: 'Rate improved for buying cNGN. Topped up naira to keep daily spending money handy.',
    txHash: '0xbbb222ccc333ddd444eee555fff666aaa777bbb888ccc999ddd000eee111fff2',
    status: 'confirmed',
    at: new Date(Date.now() - 26 * 60_000).toISOString(),
  },
  {
    id: '3',
    kind: 'deposit',
    in: money('cNGN', '200000000000000000000000', '200000', '126.18'),
    reason: 'You deposited cNGN into the vault.',
    txHash: '0xccc333ddd444eee555fff666aaa777bbb888ccc999ddd000eee111fff222aaa3',
    status: 'confirmed',
    at: new Date(Date.now() - 3 * 24 * 60_000).toISOString(),
  },
];

export const mockApprovals: ApprovalItem[] = [
  {
    id: 'a1',
    in: money('cNGN', '120000000000000000000000', '120000', '75.71'),
    minOut: money('USDT', '75000000', '118875', '75.00'),
    reason: 'Rate moved 2.1% against naira. Needs your approval because it is above your threshold.',
    expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
  },
];

export const mockAgent: AgentStatus = {
  address: '0xa2a173a481bc063fee0ef11c67fc756dc5f928f4',
  lastRunAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  healthy: true,
};
