import { encodeFunctionData, parseAbi } from 'viem';

/** A firm quote from an RFQ venue. The vault (taker) approves `spender` for `takerPays` and calls `target` with `data`. */
export type RfqQuote = {
  quoted: true;
  takerPays: bigint;
  buyAmount: bigint;
  spender: `0x${string}`;
  target: `0x${string}`;
  data: `0x${string}`;
  /** Venue expiry (Textile: ~90s TTL on Celo). */
  expiresAt: Date;
  /** When the agent received the quote. Staleness is measured from here. */
  receivedAt?: Date;
};
export type RfqNoQuote = { quoted: false; reason: string };
export type RfqResult = RfqQuote | RfqNoQuote;

export type RfqRequest = {
  chainId: number;
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  sellAmount: bigint;
  /** Always the vault: Textile orders are exclusive to the taker, and the vault is the taker. */
  taker: `0x${string}`;
};

export interface RfqClient {
  readonly venue: string;
  request(req: RfqRequest): Promise<RfqResult>;
}

export const TEXTILE_API = 'https://api.textilecredit.com';

/** Textile confirmed Celo RFQ quotes live 90s. No max size beyond available liquidity. */
export const TEXTILE_QUOTE_TTL_SEC = 90;
export const DEFAULT_QUOTE_MAX_AGE_SEC = 75;

/** Max age (s) before the agent refuses to submit a quote. QUOTE_MAX_AGE_SEC, default 75, never above the 90s TTL. */
export function quoteMaxAgeSec(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.QUOTE_MAX_AGE_SEC);
  if (!env.QUOTE_MAX_AGE_SEC || !Number.isFinite(n) || n <= 0) return DEFAULT_QUOTE_MAX_AGE_SEC;
  return Math.min(n, TEXTILE_QUOTE_TTL_SEC);
}

/** The earlier of the venue's expiry and receivedAt + maxAge. Past this the quote must not be sent. */
export function effectiveExpiry(q: Pick<RfqQuote, 'expiresAt' | 'receivedAt'>, maxAgeSec = quoteMaxAgeSec()): Date {
  const venue = q.expiresAt.getTime();
  if (!q.receivedAt) return new Date(venue);
  return new Date(Math.min(venue, q.receivedAt.getTime() + maxAgeSec * 1000));
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Textile FX RFQ (docs/textile-research.md). POST /v2/rfq/request with taker = vault.
 * Auth: partner key (TEXTILE_API_KEY, rfq:aggregator scope) as a Bearer token. A contract taker can't sign the
 * keyless takerProof, so with no key every request is logged as no_quote without calling the API.
 */
export class TextileRfqClient implements RfqClient {
  readonly venue = 'textile';
  constructor(
    private readonly apiKey: string | undefined = process.env.TEXTILE_API_KEY,
    private readonly fetchFn: Fetch = fetch as unknown as Fetch,
    private readonly baseUrl = TEXTILE_API,
    private readonly timeoutMs = 30_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async request(req: RfqRequest): Promise<RfqResult> {
    if (!this.apiKey) return { quoted: false, reason: 'no_api_key' };
    const env = keyEnvMismatch(this.apiKey, req.chainId);
    if (env) return { quoted: false, reason: env };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v2/rfq/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          chainId: req.chainId, sellToken: req.sellToken, buyToken: req.buyToken,
          sellAmount: req.sellAmount.toString(), taker: req.taker,
        }),
        signal: ctl.signal,
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (!res.ok) return { quoted: false, reason: `http_${res.status}:${describeError(body, this.apiKey)}` };
      return parseTextileQuote(body, this.now());
    } catch (e) {
      return { quoted: false, reason: (e as Error).name === 'AbortError' ? 'timeout' : 'request_failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Testnet chains a Textile test key (tx_test_) may call. Any other chain needs a live key (tx_live_). */
const TEXTILE_TEST_CHAINS = new Set([31337, 84532, 11142220, 11155111, 97]);

/** Textile rejects a test key on mainnet (400 invalid_request). Catch it before the call with a clear reason. */
export function keyEnvMismatch(apiKey: string, chainId: number): string | undefined {
  if (apiKey.startsWith('tx_test_') && !TEXTILE_TEST_CHAINS.has(chainId)) return `test_key_on_mainnet:chain_${chainId}_needs_tx_live_key`;
  return undefined;
}

/** Readable, secret-free error text from a Textile error body ({ error: { code, message } } or { error: string }). */
export function describeError(body: unknown, apiKey?: string): string {
  const b = body as Record<string, any> | undefined;
  const e = b?.error;
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
  let text = e && typeof e === 'object'
    ? [e.code, e.message].map(str).filter(Boolean).join(': ') || JSON.stringify(e)
    : e != null ? str(e) : JSON.stringify(b ?? {});
  if (apiKey && apiKey.length >= 8) text = text.split(apiKey).join('[redacted]');
  text = text.replace(/(tx_(?:live|test)_[A-Za-z0-9]+)\.[A-Za-z0-9_-]+/g, '$1.[redacted]');
  return text.slice(0, 300);
}

/** Parse a /v2/rfq/request body. Anything missing → no_quote (no depth is a normal outcome). */
export function parseTextileQuote(raw: Record<string, any>, receivedAt: Date = new Date()): RfqResult {
  // Live API wraps the payload in { data: {...} }; accept both shapes.
  const body = raw?.data && typeof raw.data === 'object' && !raw.quote ? raw.data : raw;
  if (body?.status === 'no_quote' || !body?.quote) return { quoted: false, reason: 'no_depth' };
  const q = body.quote;
  const swap = body.transactions?.swap;
  if (!q.takerPays || !q.buyAmount || !q.spender || !swap?.to || !swap?.data) {
    return { quoted: false, reason: 'malformed_quote' };
  }
  // No expiry in the response → assume the confirmed 90s TTL from receipt.
  const ttlExp = new Date(receivedAt.getTime() + TEXTILE_QUOTE_TTL_SEC * 1000);
  const exp = q.expiresAt == null ? ttlExp
    : typeof q.expiresAt === 'number' ? new Date(q.expiresAt < 1e12 ? q.expiresAt * 1000 : q.expiresAt) : new Date(q.expiresAt);
  if (Number.isNaN(exp.getTime())) return { quoted: false, reason: 'malformed_quote' };
  return {
    quoted: true,
    takerPays: BigInt(q.takerPays),
    buyAmount: BigInt(q.buyAmount),
    spender: q.spender,
    target: swap.to,
    data: swap.data,
    expiresAt: exp,
    receivedAt,
  };
}

export const mockReactorAbi = parseAbi([
  'function fill((address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 deadline) o)',
]);

/**
 * Celo Sepolia stand-in (Textile isn't deployed there). Quotes at the mock market rate and builds
 * MockTextileReactor.fill calldata, so the vault runs the same swapViaRfq path as on mainnet.
 */
export class MockRfqClient implements RfqClient {
  readonly venue = 'textile';
  constructor(
    private readonly o: {
      reactor: `0x${string}`;
      cngn: `0x${string}`;
      /** Market ₦ per $1 for the mock quote. */
      rateNgnPerUsd: () => Promise<number> | number;
      decimals: (token: `0x${string}`) => number;
      ttlSec?: number;
      maxAgeSec?: number;
      now?: () => Date;
      /** Return false to simulate "no offer right now". */
      hasDepth?: () => boolean;
    },
  ) {}

  async request(req: RfqRequest): Promise<RfqResult> {
    if (this.o.hasDepth && !this.o.hasDepth()) return { quoted: false, reason: 'no_depth' };
    const rate = await this.o.rateNgnPerUsd();
    const dIn = this.o.decimals(req.sellToken);
    const dOut = this.o.decimals(req.buyToken);
    const rateE6 = BigInt(Math.round(rate * 1e6));
    const sellingNgn = req.sellToken.toLowerCase() === this.o.cngn.toLowerCase();
    // out = in * 10^dOut / 10^dIn, then ÷rate (NGN→USD) or ×rate (USD→NGN).
    const scaled = (req.sellAmount * 10n ** BigInt(dOut)) / 10n ** BigInt(dIn);
    const buyAmount = sellingNgn ? (scaled * 1_000_000n) / rateE6 : (scaled * rateE6) / 1_000_000n;
    const now = this.o.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + (this.o.ttlSec ?? TEXTILE_QUOTE_TTL_SEC) * 1000);
    // On-chain deadline never later than the quote's usable expiry.
    const deadlineAt = effectiveExpiry({ expiresAt, receivedAt: now }, this.o.maxAgeSec ?? quoteMaxAgeSec());
    const data = encodeFunctionData({
      abi: mockReactorAbi,
      functionName: 'fill',
      args: [{
        tokenIn: req.sellToken, tokenOut: req.buyToken, amountIn: req.sellAmount, amountOut: buyAmount,
        deadline: BigInt(Math.floor(deadlineAt.getTime() / 1000)),
      }],
    });
    return {
      quoted: true, takerPays: req.sellAmount, buyAmount, spender: this.o.reactor, target: this.o.reactor, data, expiresAt, receivedAt: now,
    };
  }
}
