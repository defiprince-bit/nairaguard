import { type PublicClient, parseAbi } from 'viem';

/** Rate source: ₦ per $1. Real Textile impl lands in Task 8. */
export interface RateSource {
  getRateNgnPerUsd(): Promise<number>;
}

/** Fixed rate, for tests. */
export class FixedRateSource implements RateSource {
  constructor(private readonly rate: number) {}
  async getRateNgnPerUsd() {
    return this.rate;
  }
}

const routerAbi = parseAbi(['function quote(address,address,uint256) view returns (uint256)']);

/** Reads the on-chain MockSwapRouter quote for 1 USD₮ → cNGN (both 18 decimals). */
export class MockRouterRateSource implements RateSource {
  constructor(
    private readonly client: PublicClient,
    private readonly router: `0x${string}`,
    private readonly usdt: `0x${string}`,
    private readonly cngn: `0x${string}`,
  ) {}
  async getRateNgnPerUsd() {
    const out = await this.client.readContract({
      address: this.router,
      abi: routerAbi,
      functionName: 'quote',
      args: [this.usdt, this.cngn, 10n ** 18n],
    });
    return Number(out) / 1e18;
  }
}
