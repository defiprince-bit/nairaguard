-- Wallets that never count toward the independent-user check (design.md §4).
CREATE TABLE IF NOT EXISTS excluded_wallets (
  address    TEXT PRIMARY KEY CHECK (address = lower(address) AND address ~ '^0x[0-9a-f]{40}$'),
  reason     TEXT NOT NULL CHECK (reason IN ('team', 'test', 'funded_by_us')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO excluded_wallets (address, reason, note) VALUES
  ('0x1ab29bdaac75255501adbbdcc2150fe4d346c0a7', 'team', 'deployer'),
  ('0xa2a173a481bc063fee0ef11c67fc756dc5f928f4', 'team', 'agent'),
  ('0x3dd60905fb109bcbaa1a8b37dc9ff61015e3c6f1', 'test', 'Railway e2e waitlist test 2026-10-14'),
  ('0xa9c89034aba2ce14fbf6f241aa8cdc4ec47639c0', 'test', 'Railway e2e waitlist test (chain 42220) 2026-10-14')
ON CONFLICT (address) DO NOTHING;
