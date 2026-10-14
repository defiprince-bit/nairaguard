/**
 * The one list of waitlist signup sources (design.md §4). Imported by the agent API and by the dashboard's
 * /api/waitlist route, so the two cannot drift apart. Keep this file dependency-free.
 */
export const WAITLIST_SOURCE_LIST = [
  'x', 'celo-ng', 'celo-africa-dao', 'minipay', 'whatsapp-freelancers', 'referral', 'valora',
] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCE_LIST)[number] | 'direct';
export const WAITLIST_SOURCES: ReadonlySet<string> = new Set(WAITLIST_SOURCE_LIST);
export const normaliseSource = (s: unknown): WaitlistSource =>
  (typeof s === 'string' && WAITLIST_SOURCES.has(s) ? (s as WaitlistSource) : 'direct');
