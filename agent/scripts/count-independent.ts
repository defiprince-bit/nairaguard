/**
 * Count independent users (read-only; Celo mainnet data via Blockscout). Candidates are owners of vaults
 * created by the VaultFactory on Celo mainnet (design.md §7). Sepolia vaults/verifications never count.
 *   DATABASE_URL=... pnpm tsx scripts/count-independent.ts            # table + JSON
 *   ... count-independent.ts --include-waitlist                        # also verified waitlist wallets (non-Sepolia)
 *   ... count-independent.ts --factory 0x… --chain 42220              # restrict to one factory / chain
 *   ... count-independent.ts --cutoff 2026-10-05T23:00:00Z   # override cutoff (or INDEPENDENT_CUTOFF env)
 *   ... count-independent.ts --max-fanout 20                    # intermediary payee limit (or MAX_FANOUT env)
 *   ... count-independent.ts --json                                    # JSON only
 *   ... count-independent.ts --exclude 0xabc… --reason test --note "x" # add an excluded wallet, then count
 * Prints only wallet addresses and reasons, never contacts.
 */
import { readFileSync } from 'node:fs';
import { isAddress } from 'viem';
import { connect, migrate } from '../src/db.js';
import {
  BlockscoutLookup, countIndependent, EXCLUDE_REASONS, type ExcludeReason, renderTable, selectCandidates,
} from '../src/independent.js';

const DEPLOYER = '0x1ab29BDaAc75255501ADBBdcC2150fe4D346C0A7';
const AGENT = '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const cutoffArg = flag('--cutoff') ?? process.env.INDEPENDENT_CUTOFF;
if (cutoffArg && Number.isNaN(new Date(cutoffArg).getTime())) throw new Error('--cutoff must be an ISO date, e.g. 2026-10-05T23:00:00Z');

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

const candidates = await selectCandidates(db, {
  factory: flag('--factory') ?? process.env.MAINNET_FACTORY_ADDRESS,
  chainId: Number(flag('--chain') ?? 42220),
  includeWaitlist: args.includes('--include-waitlist'),
});
console.error(`candidates: ${candidates.wallets.length} (vault owners ${candidates.vaultOwners}, waitlist ${candidates.waitlist})`);
const excluded = await db.query<{ address: string; reason: ExcludeReason }>('SELECT address, reason FROM excluded_wallets');
const result = await countIndependent({
  verifiedWallets: candidates.wallets,
  excluded: excluded.rows,
  teamSources: [DEPLOYER, AGENT],
  lookup: new BlockscoutLookup(process.env.BLOCKSCOUT_API ?? 'https://celo.blockscout.com/api', fetch, Number(process.env.BLOCKSCOUT_MAX_PAGES ?? 5)),
  cutoff: cutoffArg ? new Date(cutoffArg) : undefined,
  maxFanout: Number(flag('--max-fanout') ?? process.env.MAX_FANOUT ?? 20),
  allowlist: (JSON.parse(readFileSync(new URL('../config/exchange-allowlist.json', import.meta.url), 'utf8')) as { wallets: { address: string }[] })
    .wallets.map((w) => w.address),
});

if (!args.includes('--json')) console.log(renderTable(result), '\n');
console.log(JSON.stringify(result, null, 2));
await (db as unknown as { end?: () => Promise<void>; close?: () => Promise<void> }).end?.();
process.exit(0);
