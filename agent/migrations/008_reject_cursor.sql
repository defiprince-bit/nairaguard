-- Reject (design.md field contract): rejected approvals are final; agent cools down before re-proposing.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS reject_tx TEXT;
-- cNGN share (bps) of the vault when the trade was proposed; used to tell whether drift has changed.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS ngn_share_bps INTEGER;
ALTER TABLE activity DROP CONSTRAINT IF EXISTS activity_status_check;
ALTER TABLE activity ADD CONSTRAINT activity_status_check
  CHECK (status IN ('pending', 'confirmed', 'failed', 'skipped', 'rejected'));
-- Keyset paging for /activity on (created_at, id), newest first.
CREATE INDEX IF NOT EXISTS activity_vault_cursor_idx ON activity (lower(vault), created_at DESC, id DESC);
