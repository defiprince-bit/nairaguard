-- Task 8a: per-user vaults discovered from VaultFactory.VaultCreated logs.
CREATE TABLE IF NOT EXISTS vaults (
  vault          TEXT PRIMARY KEY,           -- lowercased
  owner          TEXT NOT NULL,              -- lowercased
  factory        TEXT NOT NULL,              -- lowercased
  chain_id       INTEGER NOT NULL,
  created_block  BIGINT NOT NULL,
  created_tx     TEXT NOT NULL,
  first_deposit_tx TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vaults_owner_factory_uniq ON vaults (owner, factory);

-- Log-scan cursor per (chain, factory) so restarts resume instead of re-scanning.
CREATE TABLE IF NOT EXISTS factory_scan (
  chain_id           INTEGER NOT NULL,
  factory            TEXT NOT NULL,
  last_scanned_block BIGINT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, factory)
);

-- How a waitlist wallet was verified: 'siwe' | 'create_vault' | 'deposit' (on-chain, from the wallet itself).
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS verified_via TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS verified_tx TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS verified_chain_id INTEGER;
