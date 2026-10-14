-- Task 8b (design.md §8): one row per RFQ the agent requests, filled or not (Textile scores quoted AND filled volume).
CREATE TABLE IF NOT EXISTS textile_quotes (
  id BIGSERIAL PRIMARY KEY,
  vault TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT 'textile',
  side TEXT NOT NULL CHECK (side IN ('ngnToUsd', 'usdToNgn')),
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  sell_amount TEXT NOT NULL,          -- requested size (tokenIn base units)
  size_usd NUMERIC,                   -- requested size in USD
  quoted BOOLEAN NOT NULL,
  taker_pays TEXT,                    -- tokenIn incl. 1 bp fee
  buy_amount TEXT,                    -- firm tokenOut
  rate_ngn_per_usd NUMERIC,           -- quote rate
  feed_rate_ngn_per_usd NUMERIC,      -- Chainlink NGN/USD at request time (official-vs-market gap)
  feed_updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  approval_id TEXT,                   -- on-chain approval id when executing an approved proposal
  outcome TEXT NOT NULL CHECK (outcome IN ('filled', 'expired', 'declined', 'no_quote', 'price_moved')),
  outcome_reason TEXT,
  tx_hash TEXT,
  amount_out TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS textile_quotes_requested_idx ON textile_quotes (requested_at DESC);
CREATE INDEX IF NOT EXISTS textile_quotes_vault_idx ON textile_quotes (lower(vault), requested_at DESC);

-- Approvals: user floor + execution window (approve(id) opens a 30-min window on-chain).
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS window_expires_at TIMESTAMPTZ;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS executed_tx TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_status_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_status_check
  CHECK (status IN ('pending', 'approved', 'executed', 'expired', 'rejected'));

-- Venue per trade, derived from the on-chain Swapped.target via the factory's pair label (never agent-claimed).
ALTER TABLE activity ADD COLUMN IF NOT EXISTS venue TEXT;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS venue_target TEXT;
