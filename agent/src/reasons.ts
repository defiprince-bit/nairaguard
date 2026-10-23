/** User-facing text for stored RFQ outcome reasons (textile_quotes.outcome_reason). Works on old rows too. */
const KNOWN: Record<string, string> = {
  taker_pays_above_amount: 'The exchange asked for more than planned, so no trade.',
  venue_not_allowlisted: 'The exchange route is not on the allowlist, so no trade.',
  below_feed_floor: 'The exchange price was too far below the naira reference rate, so no trade.',
  below_approved_min_out: "Price moved, didn't trade.",
};
export const NO_OFFER_TEXT = 'No offer available right now. Will try again next check.';

export function friendlyReason(outcome: string | null | undefined, raw: string | null | undefined): string {
  const r = (raw ?? '').trim();
  if (KNOWN[r]) return KNOWN[r];
  const m = /^http_(\d{3})/.exec(r);
  if (m) {
    const s = Number(m[1]);
    if (s === 401 || s === 403) return 'The exchange could not be reached right now. Will try again next check.';
    if (s === 429) return 'The exchange is busy right now. Will try again next check.';
    if (s >= 400 && s < 500) return 'The exchange rejected the quote. Will try again next check.';
    return 'The exchange had a problem. Will try again next check.';
  }
  if (outcome === 'no_quote' || r === 'no_quote' || r === '') return NO_OFFER_TEXT;
  if (outcome === 'expired') return 'The offer expired before it could be used, so no trade.';
  if (outcome === 'price_moved') return "Price moved, didn't trade.";
  if (/[_:]|object Object/.test(r) || !/\s/.test(r)) return outcome === 'declined' ? 'The exchange offer was declined, so no trade.' : NO_OFFER_TEXT;
  return r;
}
