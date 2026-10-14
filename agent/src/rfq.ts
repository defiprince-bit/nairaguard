import { encodeFunctionData, parseAbi } from 'viem';

/** A firm quote from an RFQ venue. The vault (taker) approves `spender` for `takerPays` and calls `target` with `data`. */
export type RfqQuote = {
  quoted: true;
  takerPays: bigint;
  buyAmount: bigint;
  spender: `0x${string}`;
  target: `0x${string}`;
  data: `0x${string}`;
  expiresAt: Date;
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
    private readonly timeoutMs = 75_000,
  ) {}

  async request(req: RfqRequest): Promise<RfqResult> {
    if (!this.apiKey) return { quoted: false, reason: 'no_api_key' };
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
      if (!res.ok) return { quoted: false, reason: `http_${res.status}${body?.error ? `:${String(body.error).slice(0, 80)}` : ''}` };
      return parseTextileQuote(body);
    } catch (e) {
      return { quoted: false, reason: (e as Error).name === 'AbortError' ? 'timeout' : 'request_failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse a /v2/rfq/request body. Anything missing → no_quote (no depth is a normal outcome). */
export function parseTextileQuote(body: Record<string, any>): RfqResult {
  if (body?.status === 'no_quote' || !body?.quote) return { quoted: false, reason: 'no_depth' };
  const q = body.quote;
  const swap = body.transactions?.swap;
  if (!q.takerPays || !q.buyAmount || !q.spender || !swap?.to || !swap?.data || !q.expiresAt) {
    return { quoted: false, reason: 'malformed_quote' };
  }
  const exp = typeof q.expiresAt === 'number' ? new Date(q.expiresAt < 1e12 ? q.expiresAt * 1000 : q.expiresAt) : new Date(q.expiresAt);
  return {
    quoted: true,
    takerPays: BigInt(q.takerPays),
    buyAmount: BigInt(q.buyAmount),
    spender: q.spender,
    target: swap.to,
    data: swap.data,
    expiresAt: exp,
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
    const expiresAt = new Date(now.getTime() + (this.o.ttlSec ?? 30) * 1000);
    const data = encodeFunctionData({
      abi: mockReactorAbi,
      functionName: 'fill',
      args: [{
        tokenIn: req.sellToken, tokenOut: req.buyToken, amountIn: req.sellAmount, amountOut: buyAmount,
        deadline: BigInt(Math.floor(expiresAt.getTime() / 1000)),
      }],
    });
    return {
      quoted: true, takerPays: req.sellAmount, buyAmount, spender: this.o.reactor, target: this.o.reactor, data, expiresAt,
    };
  }
}
