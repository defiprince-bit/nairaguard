-- "Checked, no trade needed" rows: activity kind='noop' with a stable check_code (in_band, below_min, ...).
-- Only rows with a check_code are shown in /activity (older per-tick noop rows stay hidden). The agent writes
-- one only when the code changes from the vault's last check (or a trade happened since), so no per-tick spam.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS check_code TEXT;
CREATE INDEX IF NOT EXISTS activity_vault_checks_idx ON activity (lower(vault), created_at DESC, id DESC)
  WHERE kind <> 'noop' OR check_code IS NOT NULL;
