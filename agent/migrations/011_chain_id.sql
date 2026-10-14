-- Task 9: split every per-row table used in stats/counts by chain, so Sepolia test rows never reach mainnet numbers.
-- Existing rows all came from Celo Sepolia (11142220). The default only keeps old ad-hoc inserts working;
-- the agent always writes chain_id explicitly from its own NETWORK.
ALTER TABLE textile_quotes ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE activity       ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE approvals      ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE agent_runs     ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE quotes         ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE vault_baseline ADD COLUMN IF NOT EXISTS chain_id INTEGER;

UPDATE textile_quotes SET chain_id = 11142220 WHERE chain_id IS NULL;
UPDATE activity       SET chain_id = 11142220 WHERE chain_id IS NULL;
UPDATE approvals      SET chain_id = 11142220 WHERE chain_id IS NULL;
UPDATE agent_runs     SET chain_id = 11142220 WHERE chain_id IS NULL;
UPDATE quotes         SET chain_id = 11142220 WHERE chain_id IS NULL;
UPDATE vault_baseline SET chain_id = 11142220 WHERE chain_id IS NULL;
UPDATE vaults         SET chain_id = 11142220 WHERE chain_id IS NULL;

ALTER TABLE textile_quotes ALTER COLUMN chain_id SET DEFAULT 11142220, ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE activity       ALTER COLUMN chain_id SET DEFAULT 11142220, ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE approvals      ALTER COLUMN chain_id SET DEFAULT 11142220, ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE agent_runs     ALTER COLUMN chain_id SET DEFAULT 11142220, ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE quotes         ALTER COLUMN chain_id SET DEFAULT 11142220, ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE vault_baseline ALTER COLUMN chain_id SET DEFAULT 11142220, ALTER COLUMN chain_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS textile_quotes_chain_idx ON textile_quotes (chain_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS activity_chain_idx ON activity (chain_id);
CREATE INDEX IF NOT EXISTS quotes_chain_vault_idx ON quotes (chain_id, vault);
