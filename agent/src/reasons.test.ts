import { describe, expect, it } from 'vitest';
import { friendlyReason } from './reasons.js';
import { describeError } from './rfq.js';

describe('friendlyReason', () => {
  it('maps raw http errors (incl. old [object Object] rows)', () => {
    expect(friendlyReason('no_quote', 'http_400:[object Object]')).toBe('The exchange rejected the quote. Will try again next check.');
    expect(friendlyReason('no_quote', 'http_503:x')).toMatch(/had a problem/);
    expect(friendlyReason('no_quote', 'http_429:x')).toMatch(/busy/);
  });
  it('maps codes and empty no_quote', () => {
    expect(friendlyReason('no_quote', null)).toMatch(/No offer available/);
    expect(friendlyReason('declined', 'below_feed_floor')).toMatch(/reference rate/);
    expect(friendlyReason('declined', 'weird_code')).toMatch(/declined/);
  });
  it('keeps human sentences', () => {
    expect(friendlyReason('declined', 'Price moved a lot today.')).toBe('Price moved a lot today.');
  });
});

describe('describeError', () => {
  it('never yields [object Object]', () => {
    expect(describeError({ error: { code: 'bad', message: { detail: 'x' } } })).not.toContain('[object Object]');
    expect(describeError({ error: { detail: 'x' } })).toContain('detail');
    expect(describeError({ message: { a: 1 } })).not.toContain('[object Object]');
  });
});
