import { describe, expect, it } from 'vitest';
import { checkRange, checkTitle, isCheck, matchesFilter } from './format';
import type { ActivityItem } from './types';

// Shape of the agent's /activity item for a no-trade check (see agent/src/api.ts).
const base: ActivityItem = {
  id: '271', kind: 'check', reason: "Naira share is 50%, target 50%. That's within the 5% band, so no trade.",
  txHash: undefined as unknown as string, status: 'skipped', at: '2026-10-17T15:22:21.113Z', outcome: null, code: 'in_band', count: 1,
};

describe('no-trade check rows', () => {
  it('every kind "check" item is a check row, never a swap', () => {
    expect(isCheck(base)).toBe(true);
    expect(isCheck({ ...base, outcome: 'no_quote' })).toBe(true);
    expect(isCheck({ ...base, kind: 'swap' })).toBe(false);
  });

  it('titles: single, collapsed run, and RFQ outcome', () => {
    expect(checkTitle(base)).toBe('Checked, no trade needed');
    expect(checkTitle({ ...base, count: 4 })).toBe('Checked 4 times, no trade needed');
    expect(checkTitle({ ...base, outcome: 'no_quote', count: 2 })).toBe('Checked 2 times, no trade');
  });

  it('time range: one time for a single check, a range for a run', () => {
    const one = checkRange(base);
    expect(one).toMatch(/^\d{2}:\d{2}$/);
    const same = checkRange({ ...base, count: 3, firstAt: '2026-10-17T10:00:00Z', lastAt: '2026-10-17T11:30:00Z' });
    expect(same).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
    const days = checkRange({ ...base, count: 3, firstAt: '2026-10-14T10:00:00Z', lastAt: '2026-10-16T11:30:00Z' });
    expect(days).toMatch(/14 Oct \d{2}:\d{2} – 16 Oct \d{2}:\d{2}/);
  });

  it('checks are not "pending": the Pending and Executed filters skip them', () => {
    expect(matchesFilter(base, 'pending')).toBe(false);
    expect(matchesFilter(base, 'executed')).toBe(false);
    expect(matchesFilter(base, 'all')).toBe(true);
  });
});
