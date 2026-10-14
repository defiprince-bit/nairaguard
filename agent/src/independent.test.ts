import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { type Db, migrate } from './db.js';
import { BlockscoutLookup, type ChainLookup, countIndependent, renderTable } from './independent.js';

const DEPLOYER = '0x1ab29bdaac75255501adbbdcc2150fe4d346c0a7';
const AGENT = '0xa2a173a481bc063fee0ef11c67fc756dc5f928f4';
const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

function fake(first: Record<string, string | null>, recipients: Record<string, string[]>): ChainLookup & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async firstActivityAt(x) { asked.push(x); const v = first[x]; return v ? new Date(v) : null; },
    async recipientsOf(s) { return new Set(recipients[s] ?? []); },
  };
}

describe('countIndependent', () => {
  it('drops excluded, team-funded, new and inactive wallets with reasons', async () => {
    const teamExtra = a(99);
    const lookup = fake(
      { [a(1)]: '2025-01-01T00:00:00Z', [a(4)]: '2026-10-06T00:00:00Z', [a(5)]: null, [a(6)]: '2026-10-05T23:59:59Z' },
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
      [a(4)]: 'first_tx_after_cutoff:2026-10-06',
      [a(5)]: 'no_mainnet_activity',
      [a(7)]: 'excluded:test',
    });
    expect(r.byReason).toMatchObject({ funded_by_team: 2, 'excluded:test': 1 });
    expect(lookup.asked).not.toContain(a(7)); // excluded wallets need no lookup
    expect(renderTable(r)).toContain('Independent (active on Celo mainnet before 2026-10-06): 2');
  });
});

describe('BlockscoutLookup (mocked fetch)', () => {
  const res = (result: unknown, message = 'OK') => new Response(JSON.stringify({ status: Array.isArray(result) && result.length ? '1' : '0', message, result }));
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
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.address === DEPLOYER)?.reason).toBe('team');
    expect(rows.find((r) => r.address === AGENT)?.reason).toBe('team');
    await expect(db.query(`INSERT INTO excluded_wallets (address, reason) VALUES ($1,'friend')`, [a(1)])).rejects.toThrow();
    await expect(db.query(`INSERT INTO excluded_wallets (address, reason) VALUES ('0xABC','test')`)).rejects.toThrow();
  });
});
