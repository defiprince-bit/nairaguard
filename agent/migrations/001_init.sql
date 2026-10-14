-- NairaGuard agent tables (design.md §4). Amounts are token base units as text.
CREATE TABLE IF NOT EXISTS activity (
  id           BIGSERIAL PRIMARY KEY,
  vault        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('swap', 'propose', 'deposit', 'withdraw', 'noop')),
  token_in     TEXT,
  token_out    TEXT,
  amount_in    TEXT,
  min_out      TEXT,
  usd_value    TEXT,
  rate         TEXT,
  reason       TEXT NOT NULL,
  tx_hash      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed', 'skipped')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_vault_created_idx ON activity (vault, created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id           BIGSERIAL PRIMARY KEY,
  vault        TEXT NOT NULL,
  onchain_id   TEXT NOT NULL,
  token_in     TEXT NOT NULL,
  token_out    TEXT NOT NULL,
  amount_in    TEXT NOT NULL,
  min_out      TEXT NOT NULL,
  usd_value    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  tx_hash      TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'expired', 'rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vault, onchain_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id           BIGSERIAL PRIMARY KEY,
  vault        TEXT NOT NULL,
  ok           BOOLEAN NOT NULL,
  error        TEXT,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
