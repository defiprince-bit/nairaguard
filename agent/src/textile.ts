/** Rate source: ₦ per $1. The strategy's sizing rate; the RFQ quote sets the real price (Task 8b). */
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

/** Rate source backed by a function (e.g. the Chainlink feed or a mock market rate). */
export class FnRateSource implements RateSource {
  constructor(private readonly fn: () => Promise<number> | number) {}
  async getRateNgnPerUsd() {
    return this.fn();
  }
}
