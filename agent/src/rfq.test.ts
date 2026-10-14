import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { interpretFeed } from './feed.js';
import { MockRfqClient, mockReactorAbi, parseTextileQuote, TextileRfqClient } from './rfq.js';

const VAULT = '0xD436aA344C0E2a58a607443680651a2c32066be6' as const;
const CNGN = '0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f' as const;
const USDT = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as const;
const REACTOR = '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3' as const;
const req = { chainId: 42220, sellToken: CNGN, buyToken: USDT, sellAmount: 13_615_000_000n, taker: VAULT };

describe('Textile RFQ client', () => {
  it('logs no_quote without calling the API when there is no key', async () => {
    let called = false;
    const c = new TextileRfqClient(undefined, (async () => { called = true; throw new Error('x'); }) as never);
    expect(await c.request(req)).toEqual({ quoted: false, reason: 'no_api_key' });
    expect(called).toBe(false);
  });

  it('POSTs /v2/rfq/request with taker = vault and the Bearer key', async () => {
    let seen: any;
    const fetchFn = async (url: string, init: any) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({
        quote: { takerPays: '13615000000', buyAmount: '10003674', feeAmount: '1361500', spender: REACTOR, reactor: REACTOR, expiresAt: 1_800_000_030 },
        transactions: { swap: { to: REACTOR, data: '0xabcdef' } },
      }) };
    };
    const c = new TextileRfqClient('tx_live_test', fetchFn as never);
    const r = await c.request(req);
    expect(seen.url).toBe('https://api.textilecredit.com/v2/rfq/request');
    expect(seen.init.method).toBe('POST');
    expect(seen.init.headers.authorization).toBe('Bearer tx_live_test');
    expect(JSON.parse(seen.init.body)).toEqual({ chainId: 42220, sellToken: CNGN, buyToken: USDT, sellAmount: '13615000000', taker: VAULT });
    expect(r).toMatchObject({ quoted: true, takerPays: 13_615_000_000n, buyAmount: 10_003_674n, spender: REACTOR, target: REACTOR, data: '0xabcdef' });
    if (r.quoted) expect(r.expiresAt.toISOString()).toBe(new Date(1_800_000_030_000).toISOString());
  });

  it('treats no depth, HTTP errors and malformed bodies as no_quote', async () => {
    expect(parseTextileQuote({ status: 'no_quote' })).toEqual({ quoted: false, reason: 'no_depth' });
    expect(parseTextileQuote({ quote: { takerPays: '1' } })).toEqual({ quoted: false, reason: 'malformed_quote' });
    const c = new TextileRfqClient('k', (async () => ({ ok: false, status: 401, json: async () => ({ error: 'bad key' }) })) as never);
    expect(await c.request(req)).toEqual({ quoted: false, reason: 'http_401:bad key' });
    const t = new TextileRfqClient('k', (async () => { throw new Error('net'); }) as never);
    expect(await t.request(req)).toEqual({ quoted: false, reason: 'request_failed' });
  });
});

describe('Sepolia mock RFQ', () => {
  it('quotes at the mock market rate using per-token decimals and builds reactor fill calldata', async () => {
    const c = new MockRfqClient({
      reactor: REACTOR, cngn: CNGN, rateNgnPerUsd: () => 1361, decimals: () => 6, now: () => new Date(1_800_000_000_000),
    });
    const r = await c.request(req);
    if (!r.quoted) throw new Error('expected quote');
    expect(r.buyAmount).toBe(10_003_673n); // ₦13,615 / 1361
    expect(r.target).toBe(REACTOR);
    expect(r.spender).toBe(REACTOR);
    const call = decodeFunctionData({ abi: mockReactorAbi, data: r.data });
    expect(call.args[0]).toMatchObject({ tokenIn: CNGN, tokenOut: USDT, amountIn: req.sellAmount, amountOut: r.buyAmount, deadline: 1_800_000_030n });
    const back = await c.request({ ...req, sellToken: USDT, buyToken: CNGN, sellAmount: 10_000_000n });
    if (back.quoted) expect(back.buyAmount).toBe(13_610_000_000n);
  });

  it('can simulate no depth', async () => {
    const c = new MockRfqClient({ reactor: REACTOR, cngn: CNGN, rateNgnPerUsd: () => 1361, decimals: () => 6, hasDepth: () => false });
    expect(await c.request(req)).toEqual({ quoted: false, reason: 'no_depth' });
  });
});

describe('feed', () => {
  it('reads decimals from the feed and flags stale or non-positive answers', () => {
    const now = new Date(1_800_000_000_000);
    const f = interpretFeed(75193n, 8, 1_799_999_880n, now);
    expect(f.rateNgnPerUsd).toBeCloseTo(1329.91, 1);
    expect(f.stale).toBe(false);
    expect(interpretFeed(751930000000000n, 18, 1_799_999_880n, now).rateNgnPerUsd).toBeCloseTo(1329.91, 1);
    expect(interpretFeed(75193n, 8, 1_799_996_399n, now).stale).toBe(true);
    expect(interpretFeed(0n, 8, 1_799_999_880n, now)).toMatchObject({ rateNgnPerUsd: null, stale: true });
    expect(interpretFeed(-1n, 8, 1_799_999_880n, now).stale).toBe(true);
  });
});
