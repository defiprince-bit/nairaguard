-- Owner's MiniPay wallet is a team wallet and never counts as an independent user.
INSERT INTO excluded_wallets (address, reason, note) VALUES
  ('0x6cac3a6ab6981419f175713b80846c57528311f6', 'team', 'owner MiniPay wallet')
ON CONFLICT (address) DO NOTHING;
