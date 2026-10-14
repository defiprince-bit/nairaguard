-- Task 5: quote + P&L logging, waitlist with SIWE verification.
-- Starting point for P&L: first run that sees a funded vault.
CREATE TABLE IF NOT EXISTS vault_baseline (
  vault        TEXT PRIMARY KEY,
  ngn_start    TEXT NOT NULL,          -- cNGN base units
  usd_start    TEXT NOT NULL,          -- USD₮ base units
  rate_start   TEXT NOT NULL,          -- ₦ per $1 at funding
  funded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every rate quote + balances the agent saw, with the P&L at that moment.
CREATE TABLE IF NOT EXISTS quotes (
  id             BIGSERIAL PRIMARY KEY,
  vault          TEXT NOT NULL,
  rate           TEXT NOT NULL,        -- ₦ per $1
  ngn_balance    TEXT NOT NULL,
  usd_balance    TEXT NOT NULL,
  value_ngn      TEXT NOT NULL,        -- vault value now, in ₦
  hold_value_ngn TEXT NOT NULL,        -- starting balances valued at this rate
  pnl_ngn        TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_vault_created_idx ON quotes (vault, created_at DESC);

-- Per-swap result: value change across the swap at the same rate (= fees + slippage, usually negative).
ALTER TABLE activity ADD COLUMN IF NOT EXISTS fee_ngn TEXT;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS pnl_ngn TEXT;

CREATE TABLE IF NOT EXISTS waitlist_nonces (
  nonce        TEXT PRIMARY KEY,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT,
  phone           TEXT,
  wallet_address  TEXT,
  verified        BOOLEAN NOT NULL DEFAULT false,
  from_minipay    BOOLEAN NOT NULL DEFAULT false,
  source          TEXT NOT NULL DEFAULT 'direct',
  consent         BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_wallet_uniq ON waitlist (lower(wallet_address)) WHERE wallet_address IS NOT NULL;
