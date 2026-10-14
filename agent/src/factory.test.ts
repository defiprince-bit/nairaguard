import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Log } from 'viem';
import { type Db, migrate } from './db.js';
import { DEPOSITED, type LogReader, listVaults, scanFactory, SWAP_REJECTED, VAULT_CREATED } from './factory.js';

const FACTORY = '0xFAC0000000000000000000000000000000000001' as const;
const ALICE = '0xa11ce00000000000000000000000000000000001';
const BOB = '0xb0b0000000000000000000000000000000000002';
const VA = '0x7a00000000000000000000000000000000000001';
const VB = '0x7b00000000000000000000000000000000000002';
const CNGN = '0xaA3B7364E418deC4Fb147f1BD2d95A4022082aEA';

type L = { block: bigint; kind: 'created' | 'deposit' | 'rejected'; address: string; args: Record<string, unknown>; tx: string };

class FakeReader implements LogReader {
  calls: { from: bigint; to: bigint; kind: string }[] = [];
  constructor(public head: bigint, public logs: L[]) {}
  async getBlockNumber() { return this.head; }
  async getLogs(a: Parameters<LogReader['getLogs']>[0]): Promise<Log[]> {
    const kind = a.event === VAULT_CREATED ? 'created' : a.event === SWAP_REJECTED ? 'rejected' : 'deposit';
    this.calls.push({ from: a.fromBlock, to: a.toBlock, kind });
    const addrs = (Array.isArray(a.address) ? a.address : [a.address]).map((x) => x.toLowerCase());
    return this.logs
      .filter((l) => l.kind === kind && l.block >= a.fromBlock && l.block <= a.toBlock && addrs.includes(l.address.toLowerCase()))
      .map((l) => ({ address: l.address, blockNumber: l.block, transactionHash: l.tx, args: l.args }) as unknown as Log);
  }
}

let db: Db;
beforeEach(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  for (const w of [ALICE, BOB]) {
    await db.query(`INSERT INTO waitlist (wallet_address, consent, from_minipay) VALUES ($1, true, true)`, [w]);
  }
});

const verified = async (w: string) =>
  (await db.query<{ verified: boolean; verified_via: string | null }>(
    'SELECT verified, verified_via FROM waitlist WHERE wallet_address=$1', [w])).rows[0];

describe('factory scan', () => {
  it('discovers vaults from VaultCreated and verifies the creator', async () => {
    const r = new FakeReader(120n, [
      { block: 105n, kind: 'created', address: FACTORY, args: { owner: ALICE, vault: VA }, tx: '0x01' },
      { block: 110n, kind: 'created', address: FACTORY, args: { owner: BOB, vault: VB }, tx: '0x02' },
    ]);
    const s = await scanFactory({ db, client: r, factory: FACTORY, chainId: 11142220, startBlock: 100n, chunk: 50n });
    expect(s.created).toBe(2);
    const vs = await listVaults(db, FACTORY, 11142220);
    expect(vs.map((v) => v.vault)).toEqual([VA, VB]);
    expect(await verified(ALICE)).toEqual({ verified: true, verified_via: 'create_vault' });
  });

  it('resumes from last_scanned_block after a restart', async () => {
    const r = new FakeReader(120n, [
      { block: 105n, kind: 'created', address: FACTORY, args: { owner: ALICE, vault: VA }, tx: '0x01' },
    ]);
    await scanFactory({ db, client: r, factory: FACTORY, chainId: 11142220, startBlock: 100n });
    const cur = await db.query<{ b: string }>('SELECT last_scanned_block::text AS b FROM factory_scan');
    expect(cur.rows[0]!.b).toBe('120');

    r.head = 130n;
    r.calls = [];
    r.logs.push({ block: 125n, kind: 'created', address: FACTORY, args: { owner: BOB, vault: VB }, tx: '0x02' });
    const s = await scanFactory({ db, client: r, factory: FACTORY, chainId: 11142220, startBlock: 100n });
    expect(s.from).toBe(121n);
    expect(r.calls.every((c) => c.from >= 121n)).toBe(true);
    expect(s.created).toBe(1);
  });

  it('verifies on first deposit from the vault owner only', async () => {
    await db.query(`UPDATE waitlist SET verified=false`);
    const r = new FakeReader(200n, [
      { block: 101n, kind: 'created', address: FACTORY, args: { owner: ALICE, vault: VA }, tx: '0x01' },
      { block: 150n, kind: 'deposit', address: VA, args: { token: CNGN, amount: 1n, from: ALICE }, tx: '0xd1' },
      { block: 160n, kind: 'deposit', address: VA, args: { token: CNGN, amount: 1n, from: ALICE }, tx: '0xd2' },
    ]);
    // Reset the create-vault verification so the deposit is what verifies.
    await scanFactory({ db, client: { ...r, getBlockNumber: async () => 120n, getLogs: r.getLogs.bind(r) }, factory: FACTORY, chainId: 1, startBlock: 100n });
    await db.query(`UPDATE waitlist SET verified=false, verified_via=NULL`);
    const s = await scanFactory({ db, client: r, factory: FACTORY, chainId: 1, startBlock: 100n });
    expect(s.deposits).toBe(1);
    expect(await verified(ALICE)).toEqual({ verified: true, verified_via: 'deposit' });
    const v = await db.query<{ first_deposit_tx: string }>('SELECT first_deposit_tx FROM vaults WHERE vault=$1', [VA]);
    expect(v.rows[0]!.first_deposit_tx).toBe('0xd1');
    expect((await verified(BOB))!.verified).toBe(false);
  });

  it('marks approvals and their propose activity rejected on SwapRejected', async () => {
    await db.query(`INSERT INTO approvals (vault, onchain_id, token_in, token_out, amount_in, min_out, usd_value, reason, tx_hash, expires_at)
      VALUES ($1,'3','a','b','1','1','1','r','0xp1','2030-01-01T00:00:00Z')`, [VA]);
    await db.query(`INSERT INTO activity (vault, kind, reason, tx_hash, status) VALUES ($1,'propose','r','0xp1','confirmed')`, [VA]);
    const r = new FakeReader(130n, [
      { block: 101n, kind: 'created', address: FACTORY, args: { owner: ALICE, vault: VA }, tx: '0x01' },
      { block: 120n, kind: 'rejected', address: VA, args: { id: 3n }, tx: '0xr1' },
    ]);
    const s = await scanFactory({ db, client: r, factory: FACTORY, chainId: 1, startBlock: 100n });
    expect(s.rejected).toBe(1);
    const ap = await db.query<{ status: string; reject_tx: string }>('SELECT status, reject_tx FROM approvals');
    expect(ap.rows[0]).toMatchObject({ status: 'rejected', reject_tx: '0xr1' });
    const act = await db.query<{ status: string }>('SELECT status FROM activity');
    expect(act.rows[0]!.status).toBe('rejected');
  });

  it('ignores VaultCreated from other contracts', async () => {
    const r = new FakeReader(110n, [
      { block: 105n, kind: 'created', address: '0x000000000000000000000000000000000000dead', args: { owner: ALICE, vault: VA }, tx: '0x01' },
    ]);
    const s = await scanFactory({ db, client: r, factory: FACTORY, chainId: 1, startBlock: 100n });
    expect(s.created).toBe(0);
    expect((await verified(ALICE))!.verified).toBe(false);
  });
});

void DEPOSITED;
