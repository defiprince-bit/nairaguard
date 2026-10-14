-- Executed approvals: actual amounts from the vault's on-chain Swapped event (never the quote).
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS executed_amount_in TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS executed_amount_out TEXT;
CREATE INDEX IF NOT EXISTS textile_quotes_vault_cursor_idx ON textile_quotes (lower(vault), requested_at, id);
