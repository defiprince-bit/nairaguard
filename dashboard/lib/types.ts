export type Money = {
  token: 'cNGN' | 'USDT';
  amount: string;
  amountNgn: string;
  amountUsd: string;
  rate: string;
  rateAt: string;
};

export type ActivityItem = {
  id: string;
  kind: 'swap' | 'deposit' | 'withdraw';
  in?: Money;
  out?: Money;
  reason: string;
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  at: string;
  /** Upcoming: the actual amount received (Money or raw base units). Missing → `out` is the min-out ("at least"). */
  amountOut?: Money | string | null;
};

export type ApprovalItem = {
  id: string;
  in: Money;
  minOut: Money;
  reason: string;
  expiresAt: string;
  /** Upcoming: may be null when the agent has no fresh rate → show "Rate unavailable", no naira figure. */
  rateNgnPerUsd?: string | null;
};

export type AgentStatus = {
  address: string;
  erc8004Id?: string;
  lastRunAt: string | null;
  /** Upcoming per-vault field; preferred over the global lastRunAt. */
  lastCheckedAt?: string | null;
  healthy: boolean;
};

export type BalancesResponse = {
  balances: Money[];
  ngnShareBps: number;
  targetNgnBps: number;
};
