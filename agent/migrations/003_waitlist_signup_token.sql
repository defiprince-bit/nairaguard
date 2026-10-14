-- Verify is authorised by a secret signup token returned once by POST /api/waitlist.
-- Only its sha256 hash (hex) is stored.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS signup_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signup_token_hash_uniq ON waitlist (signup_token_hash) WHERE signup_token_hash IS NOT NULL;
