import { type Log, parseAbiItem } from 'viem';
import type { Db } from './db.js';

export const VAULT_CREATED = parseAbiItem('event VaultCreated(address indexed owner, address indexed vault)');
export const DEPOSITED = parseAbiItem('event Deposited(address indexed token, uint256 amount, address indexed from)');

/** Narrow log reader (satisfied by viem PublicClient). */
export interface LogReader {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: `0x${string}` | `0x${string}`[];
    event: typeof VAULT_CREATED | typeof DEPOSITED;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Log[]>;
}

export type KnownVault = { vault: `0x${string}`; owner: `0x${string}` };

export type ScanOpts = {
  db: Db;
  client: LogReader;
  factory: `0x${string}`;
  chainId: number;
  /** Factory deploy block; scanning starts here on first run. */
  startBlock: bigint;
  /** Max blocks per getLogs call (RPC range limit). */
  chunk?: bigint;
};

type EvLog = Log & { args?: Record<string, unknown> };

/**
 * Incremental scan: new VaultCreated logs → `vaults`, first Deposited per vault → waitlist verification.
 * Cursor (last_scanned_block) is stored in Postgres and advanced per chunk, so restarts resume.
 */
export async function scanFactory(o: ScanOpts): Promise<{ from: bigint; to: bigint; created: number; deposits: number }> {
  const factory = o.factory.toLowerCase();
  const chunk = o.chunk ?? 5_000n;
  const cur = await o.db.query<{ b: string }>(
    'SELECT last_scanned_block::text AS b FROM factory_scan WHERE chain_id=$1 AND factory=$2', [o.chainId, factory]);
  const from = cur.rows[0] ? BigInt(cur.rows[0].b) + 1n : o.startBlock;
  const head = await o.client.getBlockNumber();
  let created = 0;
  let deposits = 0;

  for (let start = from; start <= head; start += chunk) {
    const end = start + chunk - 1n > head ? head : start + chunk - 1n;

    const vc = (await o.client.getLogs({ address: o.factory, event: VAULT_CREATED, fromBlock: start, toBlock: end })) as EvLog[];
    for (const l of vc) {
      const owner = String(l.args?.owner).toLowerCase();
      const vault = String(l.args?.vault).toLowerCase();
      const r = await o.db.query(
        `INSERT INTO vaults (vault, owner, factory, chain_id, created_block, created_tx) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (vault) DO NOTHING RETURNING vault`,
        [vault, owner, factory, o.chainId, String(l.blockNumber), l.transactionHash]);
      if (r.rows.length) created++;
      await markVerified(o.db, owner, 'create_vault', l.transactionHash ?? null, o.chainId);
    }

    const known = await listVaults(o.db, factory, o.chainId);
    if (known.length) {
      const dep = (await o.client.getLogs({
        address: known.map((k) => k.vault), event: DEPOSITED, fromBlock: start, toBlock: end,
      })) as EvLog[];
      for (const l of dep) {
        const vault = String(l.address).toLowerCase();
        const from = String(l.args?.from).toLowerCase();
        const v = known.find((k) => k.vault.toLowerCase() === vault);
        // Only the owner can deposit, but check anyway: proof must come from the wallet itself.
        if (!v || v.owner.toLowerCase() !== from) continue;
        const r = await o.db.query(
          'UPDATE vaults SET first_deposit_tx=$2 WHERE vault=$1 AND first_deposit_tx IS NULL RETURNING vault',
          [vault, l.transactionHash]);
        if (r.rows.length) {
          deposits++;
          await markVerified(o.db, from, 'deposit', l.transactionHash ?? null, o.chainId);
        }
      }
    }

    await o.db.query(
      `INSERT INTO factory_scan (chain_id, factory, last_scanned_block, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (chain_id, factory) DO UPDATE SET last_scanned_block=EXCLUDED.last_scanned_block, updated_at=now()`,
      [o.chainId, factory, String(end)]);
  }
  return { from, to: head, created, deposits };
}

/** Mark an existing waitlist row verified by on-chain proof. Never creates rows; never downgrades. */
export async function markVerified(db: Db, wallet: string, via: 'create_vault' | 'deposit', tx: string | null, chainId: number) {
  await db.query(
    `UPDATE waitlist SET verified=true, verified_via=$2, verified_tx=$3, verified_chain_id=$4
     WHERE lower(wallet_address)=$1 AND verified=false`,
    [wallet.toLowerCase(), via, tx, chainId]);
}

export async function listVaults(db: Db, factory: string, chainId: number): Promise<KnownVault[]> {
  const r = await db.query<{ vault: `0x${string}`; owner: `0x${string}` }>(
    'SELECT vault, owner FROM vaults WHERE factory=$1 AND chain_id=$2 ORDER BY created_block, vault',
    [factory.toLowerCase(), chainId]);
  return r.rows;
}
