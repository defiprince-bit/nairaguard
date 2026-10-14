-- Launch campaign: unsubscribe, per-contact send log (idempotent re-runs), contact dedupe key.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

-- Normalised contact: lower-cased trimmed email, or phone digits with a Nigerian leading 0 rewritten to 234.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS contact_key TEXT GENERATED ALWAYS AS (
  CASE
    WHEN email IS NOT NULL THEN 'e:' || lower(btrim(email))
    WHEN phone IS NOT NULL THEN 'p:' || regexp_replace(
      regexp_replace(phone, '[^0-9]', '', 'g'), '^0(\d{10})$', '234\1')
  END
) STORED;
CREATE INDEX IF NOT EXISTS waitlist_contact_key_idx ON waitlist (contact_key);

CREATE TABLE IF NOT EXISTS campaign_sends (
  id                  BIGSERIAL PRIMARY KEY,
  contact_id          BIGINT NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
  campaign            TEXT NOT NULL,
  sent_at             TIMESTAMPTZ,
  provider_message_id TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, campaign)
);
