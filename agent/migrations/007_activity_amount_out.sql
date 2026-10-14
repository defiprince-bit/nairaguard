-- Actual amount received by each swap (from the vault's Swapped event, else balance delta). min_out stays as the floor.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS amount_out TEXT;
CREATE INDEX IF NOT EXISTS agent_runs_vault_ran_idx ON agent_runs (lower(vault), ran_at DESC);
