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
};

export type ApprovalItem = {
  id: string;
  in: Money;
  minOut: Money;
  reason: string;
  expiresAt: string;
};

export type AgentStatus = {
  address: string;
  erc8004Id?: string;
  lastRunAt: string | null;
  healthy: boolean;
};

export type BalancesResponse = {
  balances: Money[];
  ngnShareBps: number;
  targetNgnBps: number;
};
