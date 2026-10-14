import { describe, expect, it } from 'vitest';
import { MAINNET_EXPECT as X, activeVenues, checkDeploy, type Observed } from './verifyDeploy.js';

const ok = (): Observed => ({
  cngn: X.cngn.toLowerCase(), usdt: X.usdt, cngnDecimals: 6, usdtDecimals: 6, priceFeed: X.priceFeed,
  feedUpdatedAt: 1_000_000, nowSec: 1_000_600,
  venueEvents: X.venues.map((v) => ({ ...v, allowed: true })),
  agent: X.agent, owner: '0x0000000000000000000000000000000000000009', pendingOwner: X.owner,
});
const exp = { ...X, venues: [...X.venues] };

describe('verify-mainnet checks', () => {
  it('passes a correct deploy before transfer', () => expect(checkDeploy(ok(), exp, false)).toEqual([]));
  it('after-transfer needs owner and empty pendingOwner', () => {
    expect(checkDeploy(ok(), exp, true)).toHaveLength(2);
    expect(checkDeploy({ ...ok(), owner: X.owner, pendingOwner: '0x0000000000000000000000000000000000000000' }, exp, true)).toEqual([]);
  });
  it('fails on wrong token, decimals, stale feed, wrong agent', () => {
    const f = checkDeploy({ ...ok(), usdt: '0x1111111111111111111111111111111111111111', cngnDecimals: 18,
      feedUpdatedAt: 1_000_000 - 3600, agent: '0x2222222222222222222222222222222222222222' }, exp, false);
    expect(f.join('\n')).toMatch(/USDT is/); expect(f.join('\n')).toMatch(/cNGN decimals 18/);
    expect(f.join('\n')).toMatch(/price feed/); expect(f.join('\n')).toMatch(/agent\(\)/);
  });
  it('venues must match exactly: extra mock, missing, wrong label, revoked', () => {
    const o = ok();
    o.venueEvents.push({ target: '0x412e3e068c834758e34f8D5468D6d8DCAddf4DE4', spender: '0x412e3e068c834758e34f8D5468D6d8DCAddf4DE4', allowed: true, label: 'textile-mock' });
    o.venueEvents.push({ ...X.venues[1], allowed: false });
    o.venueEvents[0]!.label = 'ubeswap';
    const f = checkDeploy(o, exp, false).join('\n');
    expect(f).toMatch(/unexpected/); expect(f).toMatch(/mock venue/); expect(f).toMatch(/missing venue/); expect(f).toMatch(/labelled "ubeswap"/);
  });
  it('replays allow/revoke in order', () => {
    const v = { target: '0xa', spender: '0xb', label: 't' };
    expect(activeVenues([{ ...v, allowed: true }, { ...v, allowed: false }, { ...v, allowed: true }])).toHaveLength(1);
  });
});
