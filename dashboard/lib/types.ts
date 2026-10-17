export type Money = {
  token: 'cNGN' | 'USDT';
  amount: string;
  /** Null when the agent has no rate (show "Rate unavailable"). */
  amountNgn: string | null;
  amountUsd: string | null;
  rate: string | null;
  rateAt: string | null;
};

export type ActivityItem = {
  id: string;
  /** 'check': the agent looked and decided no trade was needed (reason says why). */
  kind: 'swap' | 'deposit' | 'withdraw' | 'check';
  in?: Money;
  out?: Money;
  reason: string;
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'rejected' | 'skipped';
  at: string;
  /** Upcoming: the actual amount received (Money or raw base units). Missing → `out` is the min-out ("at least"). */
  amountOut?: Money | string | null;
  /** Task 8b: venue from the vault's on-chain Swapped.target ("textile", a pool label; "textile-mock" on Sepolia). */
  venue?: string | null;
  /** RFQ outcome for a no-trade check ("price_moved" | "no_quote"); null for a plain in-band / below-minimum check. */
  outcome?: string | null;
  /** kind 'check': stable reason code (in_band, below_min, …). */
  code?: string | null;
  /** kind 'check': consecutive identical checks are collapsed into one item; count + first/last time of the run. */
  count?: number;
  firstAt?: string;
  lastAt?: string;
};

export type ApprovalItem = {
  id: string;
  in: Money;
  minOut: Money;
  reason: string;
  expiresAt: string;
  /** Upcoming: may be null when the agent has no fresh rate → show "Rate unavailable", no naira figure. */
  rateNgnPerUsd?: string | null;
  status?: 'pending' | 'approved' | 'executed' | 'expired' | 'rejected';
  rejectedAt?: string | null;
  /** Task 8b: user's floor (tokenOut base units); the agent only trades at this or better. */
  approvedMinOut?: string;
  approvedAt?: string | null;
  executedTx?: string | null;
};

export type AgentStatus = {
  address: string;
  erc8004Id?: string;
  lastRunAt: string | null;
  /** Upcoming per-vault field; preferred over the global lastRunAt. */
  lastCheckedAt?: string | null;
  healthy: boolean;
};

/** GET /api/vault/:address/status (Task 8b adds the reference feed). */
export type VaultStatus = {
  vault: string;
  lastCheckedAt: string | null;
  ok: boolean | null;
  /** Official Chainlink ₦ per $1, reference only. */
  feedRate?: string | null;
  feedUpdatedAt?: string | null;
  paused?: 'owner' | 'stale_price' | null;
};

export type BalancesResponse = {
  balances: Money[];
  ngnShareBps: number;
  targetNgnBps: number;
};
