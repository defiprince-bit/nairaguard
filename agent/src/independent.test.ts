import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { type Db, migrate } from './db.js';
import { BlockscoutLookup, type ChainLookup, countIndependent, renderTable } from './independent.js';

const DEPLOYER = '0x1ab29bdaac75255501adbbdcc2150fe4d346c0a7';
const AGENT = '0xa2a173a481bc063fee0ef11c67fc756dc5f928f4';
const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

const res = (result: unknown, message = 'OK') => new Response(JSON.stringify({ status: Array.isArray(result) && result.length ? '1' : '0', message, result }));

function fake(first: Record<string, string | null>, recipients: Record<string, string[]>, senders: Record<string, string[]> = {}): ChainLookup & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async firstActivityAt(x) { asked.push(x); const v = first[x]; return v ? new Date(v) : null; },
    async recipientsOf(s) { return new Set(recipients[s] ?? []); },
    async sendersTo(w) { return new Set(senders[w] ?? []); },
  };
}

describe('countIndependent', () => {
  it('drops excluded, team-funded, new and inactive wallets with reasons', async () => {
    const teamExtra = a(99);
    const lookup = fake(
      { [a(1)]: '2025-01-01T00:00:00Z', [a(4)]: '2026-10-05T23:00:00Z', [a(5)]: null, [a(6)]: '2026-10-05T22:59:59Z' },
      { [DEPLOYER]: [a(2)], [teamExtra]: [a(3)] },
    );
    const r = await countIndependent({
      verifiedWallets: [a(1), a(2), a(3), a(4), a(5), a(6), a(7), a(1).toUpperCase().replace('0X', '0x')],
      excluded: [{ address: a(7), reason: 'test' }, { address: teamExtra, reason: 'team' }],
      teamSources: [DEPLOYER, AGENT],
      lookup,
    });
    expect(r.verifiedTotal).toBe(7);
    expect(r.counted.sort()).toEqual([a(1), a(6)]);
    const why = Object.fromEntries(r.drops.map((d) => [d.address, d.reason]));
    expect(why).toEqual({
      [a(2)]: `funded_by_team:${DEPLOYER}`,
      [a(3)]: `funded_by_team:${teamExtra}`,
      [a(4)]: 'first_tx_after_cutoff:2026-10-05',
      [a(5)]: 'no_mainnet_activity',
      [a(7)]: 'excluded:test',
    });
    expect(r.byReason).toMatchObject({ funded_by_team: 2, 'excluded:test': 1 });
    expect(lookup.asked).not.toContain(a(7)); // excluded wallets need no lookup
    expect(renderTable(r)).toContain('Independent (active on Celo mainnet before 2026-10-05): 2');
  });
});

describe('one-hop funding + cutoff', () => {
  it('flags wallets funded by a team-funded wallet for review, not counted', async () => {
    const mid = a(50);
    const lookup = fake({ [a(1)]: '2024-01-01T00:00:00Z', [a(2)]: '2024-01-01T00:00:00Z' }, { [DEPLOYER]: [mid] }, { [a(1)]: [mid, a(77)], [a(2)]: [a(77)] });
    const r = await countIndependent({ verifiedWallets: [a(1), a(2)], excluded: [], teamSources: [DEPLOYER, AGENT], lookup });
    expect(r.counted).toEqual([a(2)]);
    expect(r.review).toEqual([{ address: a(1), reason: `funded_indirect:${mid}` }]);
    expect(r.drops).toEqual([]);
    expect(r.byReason).toEqual({ funded_indirect: 1 });
    expect(renderTable(r)).toContain('Manual review');
  });

  it('ignores busy wallets (fanout > limit) and allowlisted exchanges as intermediaries', async () => {
    const busy = a(60), ex = a(61), small = a(62);
    const many = Array.from({ length: 21 }, (_, i) => a(1000 + i));
    const lookup = fake(
      { [a(1)]: '2024-01-01T00:00:00Z', [a(2)]: '2024-01-01T00:00:00Z', [a(3)]: '2024-01-01T00:00:00Z' },
      { [DEPLOYER]: [busy, ex, small], [busy]: many, [ex]: [a(2)], [small]: Array.from({ length: 20 }, (_, i) => a(2000 + i)) },
      { [a(1)]: [busy], [a(2)]: [ex], [a(3)]: [small] },
    );
    const base = { verifiedWallets: [a(1), a(2), a(3)], excluded: [], teamSources: [DEPLOYER], lookup };
    const r = await countIndependent({ ...base, allowlist: [ex.toUpperCase().replace('0X', '0x')] });
    expect(r.counted.sort()).toEqual([a(1), a(2)]);
    expect(r.review).toEqual([{ address: a(3), reason: `funded_indirect:${small}` }]);
    expect(r.intermediaries).toEqual([{ address: small, fundedBy: DEPLOYER, fanout: 20 }]);
    expect(renderTable(r)).toContain(`${small}`);
    // Configurable limit: with 25, the busy wallet becomes an intermediary too.
    const r2 = await countIndependent({ ...base, allowlist: [ex], maxFanout: 25 });
    expect(r2.review.map((d) => d.address).sort()).toEqual([a(1), a(3)]);
    // Without the allowlist, the exchange is an intermediary (fanout 1).
    const r3 = await countIndependent({ ...base });
    expect(r3.review.map((d) => d.address)).toContain(a(2));
  });

  it('cutoff defaults to 6 Oct 00:00 WAT and is configurable', async () => {
    const lookup = fake({ [a(1)]: '2026-10-05T23:30:00Z' }, {});
    const def = await countIndependent({ verifiedWallets: [a(1)], excluded: [], teamSources: [], lookup });
    expect(def.cutoff).toBe('2026-10-05T23:00:00.000Z');
    expect(def.independent).toBe(0);
    const later = await countIndependent({ verifiedWallets: [a(1)], excluded: [], teamSources: [], lookup, cutoff: new Date('2026-10-07T00:00:00Z') });
    expect(later.independent).toBe(1);
  });
});

describe('BlockscoutLookup (mocked fetch)', () => {
  it('caches per address/list and caps pagination', async () => {
    let calls = 0;
    const full = Array.from({ length: 1000 }, () => ({ from: a(9), to: a(1), timeStamp: '1600000000' }));
    const f = (async () => { calls++; return res(full); }) as unknown as typeof fetch;
    const l = new BlockscoutLookup('https://x/api', f, 2);
    await l.firstActivityAt(a(1));
    await l.sendersTo(a(1));
    expect(calls).toBe(6); // 3 lists x 2 pages (capped), second call served from cache
    expect([...(await l.sendersTo(a(1)))]).toEqual([a(9)]);
  });

  it('takes the earliest timestamp across tx/token/internal lists', async () => {
    const f = (async (u: string) => {
      if (u.includes('action=txlist&')) return res([{ timeStamp: '1700000000' }]);
      if (u.includes('action=tokentx')) return res([{ timeStamp: '1600000000' }]);
      return res([], 'No internal transactions found');
    }) as unknown as typeof fetch;
    expect((await new BlockscoutLookup('https://x/api', f).firstActivityAt(a(1)))?.getTime()).toBe(1600000000_000);
    const none = (async () => res([], 'No transactions found')) as unknown as typeof fetch;
    expect(await new BlockscoutLookup('https://x/api', none).firstActivityAt(a(1))).toBeNull();
  });
  it('collects recipients of outgoing transfers only', async () => {
    const f = (async (u: string) => res(u.includes('action=tokentx')
      ? [{ from: DEPLOYER, to: a(2) }, { from: a(3), to: DEPLOYER }]
      : u.includes('action=txlist&') ? [{ from: DEPLOYER.toUpperCase().replace('0X', '0x'), to: a(4) }] : [])) as unknown as typeof fetch;
    expect([...(await new BlockscoutLookup('https://x/api', f).recipientsOf(DEPLOYER))].sort()).toEqual([a(2), a(4)]);
  });
});

describe('excluded_wallets migration', () => {
  it('seeds team + test wallets lowercase and enforces reasons', async () => {
    const db = new PGlite() as unknown as Db;
    await migrate(db);
    const { rows } = await db.query<{ address: string; reason: string }>('SELECT address, reason FROM excluded_wallets ORDER BY address');
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.address === DEPLOYER)?.reason).toBe('team');
    expect(rows.find((r) => r.address === AGENT)?.reason).toBe('team');
    expect(rows.find((r) => r.address === '0x6cac3a6ab6981419f175713b80846c57528311f6')?.reason).toBe('team');
    await expect(db.query(`INSERT INTO excluded_wallets (address, reason) VALUES ($1,'friend')`, [a(1)])).rejects.toThrow();
    await expect(db.query(`INSERT INTO excluded_wallets (address, reason) VALUES ('0xABC','test')`)).rejects.toThrow();
  });
});

describe('selectCandidates', () => {
  const FAC = '0x4fa967c761ed1ddb642fe62fcb9ab7b924df5310';
  async function seed() {
    const db = new PGlite() as unknown as Db;
    await migrate(db);
    const v = (vault: number, owner: number, chain: number, factory = FAC) => db.query(
      `INSERT INTO vaults (vault, owner, factory, chain_id, created_block, created_tx) VALUES ($1,$2,$3,$4,1,'0x')`,
      [a(1000 + vault), a(owner), factory, chain]);
    await v(1, 1, 42220);
    await v(2, 2, 42220, a(777));
    await v(3, 3, 11142220); // Sepolia vault: never counted
    const wl = (owner: number, verified: boolean, chain: number | null) => db.query(
      `INSERT INTO waitlist (wallet_address, consent, verified, verified_chain_id) VALUES ($1,true,$2,$3)`, [a(owner), verified, chain]);
    await wl(1, true, 42220); // also a vault owner: deduped
    await wl(4, true, null); // SIWE on mainnet
    await wl(5, true, 11142220); // verified only via Sepolia: excluded
    await wl(6, false, null); // unverified
    return db;
  }

  it('keys off mainnet vault owners by default', async () => {
    const { selectCandidates } = await import('./independent.js');
    const r = await selectCandidates(await seed());
    expect(r.wallets.sort()).toEqual([a(1), a(2)]);
  });

  it('can restrict to one factory and include non-Sepolia waitlist wallets', async () => {
    const { selectCandidates } = await import('./independent.js');
    const db = await seed();
    expect((await selectCandidates(db, { factory: FAC })).wallets).toEqual([a(1)]);
    const r = await selectCandidates(db, { includeWaitlist: true });
    expect(r.wallets.sort()).toEqual([a(1), a(2), a(4)]);
    expect(r.wallets).not.toContain(a(5));
  });

  it('refuses to count Sepolia', async () => {
    const { selectCandidates } = await import('./independent.js');
    await expect(selectCandidates(await seed(), { chainId: 11142220 })).rejects.toThrow(/Sepolia/);
  });
});
