/**
 * Count independent verified waitlist wallets (read-only; Celo mainnet data via Blockscout).
 *   DATABASE_URL=... pnpm tsx scripts/count-independent.ts            # table + JSON
 *   ... count-independent.ts --json                                    # JSON only
 *   ... count-independent.ts --exclude 0xabc… --reason test --note "x" # add an excluded wallet, then count
 * Prints only wallet addresses and reasons, never contacts.
 */
import { isAddress } from 'viem';
import { connect, migrate } from '../src/db.js';
import { BlockscoutLookup, countIndependent, EXCLUDE_REASONS, type ExcludeReason, renderTable } from '../src/independent.js';

const DEPLOYER = '0x1ab29BDaAc75255501ADBBdcC2150fe4D346C0A7';
const AGENT = '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const db = await connect();
await migrate(db);

const ex = flag('--exclude');
if (ex) {
  const reason = (flag('--reason') ?? 'test') as ExcludeReason;
  if (!isAddress(ex)) throw new Error('--exclude needs a 0x address');
  if (!EXCLUDE_REASONS.includes(reason)) throw new Error(`--reason must be one of ${EXCLUDE_REASONS.join(', ')}`);
  await db.query(
    `INSERT INTO excluded_wallets (address, reason, note) VALUES ($1,$2,$3)
     ON CONFLICT (address) DO UPDATE SET reason=EXCLUDED.reason, note=EXCLUDED.note`,
    [ex.toLowerCase(), reason, flag('--note') ?? null]);
  console.error(`excluded ${ex.toLowerCase()} (${reason})`);
}

const verified = await db.query<{ w: string }>(
  'SELECT DISTINCT lower(wallet_address) AS w FROM waitlist WHERE verified AND wallet_address IS NOT NULL');
const excluded = await db.query<{ address: string; reason: ExcludeReason }>('SELECT address, reason FROM excluded_wallets');
const result = await countIndependent({
  verifiedWallets: verified.rows.map((r) => r.w),
  excluded: excluded.rows,
  teamSources: [DEPLOYER, AGENT],
  lookup: new BlockscoutLookup(process.env.BLOCKSCOUT_API ?? 'https://celo.blockscout.com/api'),
});

if (!args.includes('--json')) console.log(renderTable(result), '\n');
console.log(JSON.stringify(result, null, 2));
await (db as unknown as { end?: () => Promise<void>; close?: () => Promise<void> }).end?.();
process.exit(0);
