-- Deposits and withdrawals per vault (Vault.Deposited / Vault.Withdrawn logs), so P&L is net of the user's own
-- money moving in or out. Before this, P&L compared today's value with the balance first seen funded, so every
-- later deposit showed up as profit. Filled by scanFlows (own cursor in factory_scan, key '<factory>#flows').
CREATE TABLE IF NOT EXISTS vault_flows (
  chain_id     INTEGER NOT NULL,
  vault        TEXT NOT NULL,               -- lowercased
  kind         TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw')),
  token        TEXT NOT NULL,               -- lowercased
  amount       TEXT NOT NULL,               -- base units
  block_number BIGINT NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS vault_flows_vault_idx ON vault_flows (chain_id, vault);
