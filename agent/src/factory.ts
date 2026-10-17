import { type Log, parseAbiItem } from 'viem';
import { type Db, markApproved, markRejected } from './db.js';

export const VAULT_CREATED = parseAbiItem('event VaultCreated(address indexed owner, address indexed vault)');
export const DEPOSITED = parseAbiItem('event Deposited(address indexed token, uint256 amount, address indexed from)');
export const SWAP_REJECTED = parseAbiItem('event SwapRejected(uint256 indexed id)');
export const SWAP_APPROVED = parseAbiItem('event SwapApproved(uint256 indexed id, uint256 approvedMinOut, uint64 expiresAt)');
export const WITHDRAWN = parseAbiItem('event Withdrawn(address indexed token, uint256 amount, address indexed to)');

/** Narrow log reader (satisfied by viem PublicClient). */
export interface LogReader {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: `0x${string}` | `0x${string}`[];
    event: typeof VAULT_CREATED | typeof DEPOSITED | typeof SWAP_REJECTED | typeof SWAP_APPROVED | typeof WITHDRAWN;
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
export async function scanFactory(o: ScanOpts): Promise<{ from: bigint; to: bigint; created: number; deposits: number; rejected: number; approved: number }> {
  const factory = o.factory.toLowerCase();
  const chunk = o.chunk ?? 5_000n;
  const cur = await o.db.query<{ b: string }>(
    'SELECT last_scanned_block::text AS b FROM factory_scan WHERE chain_id=$1 AND factory=$2', [o.chainId, factory]);
  const from = cur.rows[0] ? BigInt(cur.rows[0].b) + 1n : o.startBlock;
  const head = await o.client.getBlockNumber();
  let created = 0;
  let deposits = 0;
  let rejected = 0;
  let approved = 0;

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
      const rej = (await o.client.getLogs({
        address: known.map((k) => k.vault), event: SWAP_REJECTED, fromBlock: start, toBlock: end,
      })) as EvLog[];
      for (const l of rej) {
        const ok = await markRejected(o.db, String(l.address), String(l.args?.id), l.transactionHash ?? null, new Date());
        if (ok) rejected++;
      }
      const appr = (await o.client.getLogs({
        address: known.map((k) => k.vault), event: SWAP_APPROVED, fromBlock: start, toBlock: end,
      })) as EvLog[];
      for (const l of appr) {
        const exp = new Date(Number(l.args?.expiresAt) * 1000);
        if (await markApproved(o.db, String(l.address), String(l.args?.id), exp, new Date())) approved++;
      }
    }

    await o.db.query(
      `INSERT INTO factory_scan (chain_id, factory, last_scanned_block, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (chain_id, factory) DO UPDATE SET last_scanned_block=EXCLUDED.last_scanned_block, updated_at=now()`,
      [o.chainId, factory, String(end)]);
  }
  return { from, to: head, created, deposits, rejected, approved };
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

/**
 * Records every Deposited / Withdrawn log of known vaults in `vault_flows`, so P&L can be net of the owner's own
 * deposits and withdrawals. Own cursor ('<factory>#flows' in factory_scan) starting at the factory deploy block,
 * so existing vaults are backfilled on first run. Idempotent per (chain, tx, logIndex). Run after scanFactory.
 */
export async function scanFlows(o: ScanOpts): Promise<{ from: bigint; to: bigint; flows: number }> {
  const key = `${o.factory.toLowerCase()}#flows`;
  const chunk = o.chunk ?? 5_000n;
  const cur = await o.db.query<{ b: string }>(
    'SELECT last_scanned_block::text AS b FROM factory_scan WHERE chain_id=$1 AND factory=$2', [o.chainId, key]);
  const from = cur.rows[0] ? BigInt(cur.rows[0].b) + 1n : o.startBlock;
  const head = await o.client.getBlockNumber();
  let flows = 0;
  for (let start = from; start <= head; start += chunk) {
    const end = start + chunk - 1n > head ? head : start + chunk - 1n;
    const known = await listVaults(o.db, o.factory, o.chainId);
    if (known.length) {
      const address = known.map((k) => k.vault);
      for (const [kind, event] of [['deposit', DEPOSITED], ['withdraw', WITHDRAWN]] as const) {
        const logs = (await o.client.getLogs({ address, event, fromBlock: start, toBlock: end })) as EvLog[];
        for (const l of logs) {
          if (l.transactionHash == null || l.logIndex == null || l.args?.amount == null) continue;
          const r = await o.db.query(
            `INSERT INTO vault_flows (chain_id, vault, kind, token, amount, block_number, tx_hash, log_index)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING tx_hash`,
            [o.chainId, String(l.address).toLowerCase(), kind, String(l.args.token).toLowerCase(), String(l.args.amount),
              String(l.blockNumber), l.transactionHash, Number(l.logIndex)]);
          flows += r.rows.length;
        }
      }
    }
    await o.db.query(
      `INSERT INTO factory_scan (chain_id, factory, last_scanned_block, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (chain_id, factory) DO UPDATE SET last_scanned_block=EXCLUDED.last_scanned_block, updated_at=now()`,
      [o.chainId, key, String(end)]);
  }
  return { from, to: head, flows };
}
