/** Pure checks for scripts/verify-mainnet.ts (read-only deploy verification). Chain reads are done by the script. */
export const MAINNET_EXPECT = {
  chainId: 42220,
  cngn: '0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f',
  usdt: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
  priceFeed: '0xc17cbe2db40e53f4984c46f608da6da1ff074c11',
  agent: '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4',
  owner: '0x6Cac3a6Ab6981419f175713B80846c57528311f6',
  venues: [
    { target: '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3', spender: '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3', label: 'textile' },
    { target: '0x01b006d5c687bde182aa36F542f1f014144742e2', spender: '0x01b006d5c687bde182aa36F542f1f014144742e2', label: 'textile' },
  ],
  maxFeedAgeSec: 3600,
  decimals: 6,
} as const;

export type Expect = {
  cngn?: string; usdt?: string; priceFeed?: string; agent?: string; owner?: string; decimals: number;
  venues: { target: string; spender: string; label: string }[];
  /** Skip the feed-age check (Sepolia mock feed is updated by hand). */
  maxFeedAgeSec?: number;
};

export type VenueEvent = { target: string; spender: string; allowed: boolean; label: string };

export type Observed = {
  cngn: string; usdt: string; cngnDecimals: number; usdtDecimals: number;
  priceFeed: string; feedUpdatedAt: number; nowSec: number;
  venueEvents: VenueEvent[]; agent: string; owner: string; pendingOwner: string;
};

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';

/** Replays VenueUpdated events (in log order) into the currently allowed (target, spender) set. */
export function activeVenues(events: VenueEvent[]): VenueEvent[] {
  const m = new Map<string, VenueEvent>();
  for (const e of events) {
    const k = `${e.target.toLowerCase()}|${e.spender.toLowerCase()}`;
    if (e.allowed) m.set(k, e); else m.delete(k);
  }
  return [...m.values()];
}

/** Returns every mismatch (empty = pass). */
export function checkDeploy(o: Observed, x: Expect, afterTransfer: boolean): string[] {
  const f: string[] = [];
  const want = (name: string, got: string, exp?: string) => {
    if (exp && !eq(got, exp)) f.push(`${name} is ${got}, expected ${exp}`);
  };
  want('cNGN', o.cngn, x.cngn);
  want('USDT', o.usdt, x.usdt);
  if (o.cngnDecimals !== x.decimals) f.push(`cNGN decimals ${o.cngnDecimals}, expected ${x.decimals}`);
  if (o.usdtDecimals !== x.decimals) f.push(`USDT decimals ${o.usdtDecimals}, expected ${x.decimals}`);
  want('priceFeed', o.priceFeed, x.priceFeed);
  if (x.maxFeedAgeSec != null) {
    const age = o.nowSec - o.feedUpdatedAt;
    if (!(o.feedUpdatedAt > 0) || age > x.maxFeedAgeSec) f.push(`price feed last updated ${age}s ago (max ${x.maxFeedAgeSec}s)`);
  }
  const live = activeVenues(o.venueEvents);
  const key = (v: { target: string; spender: string }) => `${v.target.toLowerCase()}|${v.spender.toLowerCase()}`;
  for (const v of live) {
    const e = x.venues.find((w) => key(w) === key(v));
    if (!e) f.push(`unexpected allowlisted venue ${v.target}/${v.spender} (label "${v.label}")`);
    else if (v.label !== e.label) f.push(`venue ${v.target} labelled "${v.label}", expected "${e.label}"`);
    if (/mock/i.test(v.label) && !x.venues.some((w) => /mock/i.test(w.label))) f.push(`mock venue on the allowlist: ${v.target}`);
  }
  for (const e of x.venues) if (!live.some((v) => key(v) === key(e))) f.push(`missing venue ${e.target}/${e.spender}`);
  want('agent()', o.agent, x.agent);
  if (afterTransfer) {
    want('owner()', o.owner, x.owner);
    if (!eq(o.pendingOwner, ZERO)) f.push(`pendingOwner() is ${o.pendingOwner}, expected zero`);
  }
  return f;
}
