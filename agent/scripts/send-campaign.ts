/**
 * Send a waitlist email campaign through Resend (email only). Dry run by default: lists counts, sends nothing.
 *   pnpm tsx scripts/send-campaign.ts --campaign guardian-welcome-2026-10                         # dry run
 *   ... --campaign guardian-welcome-2026-10 --send --only owner@example.com                       # test-send to one address
 *   ... --campaign guardian-welcome-2026-10 --send --batch 50                                     # real batch (owner-approved)
 * Env: DATABASE_URL, RESEND_API_KEY, MAIL_FROM, UNSUBSCRIBE_SECRET (same as the agent's), DASHBOARD_URL,
 *      optional UNSUBSCRIBE_BASE_URL (default DASHBOARD_URL), EMAIL_TEMPLATE_HTML / EMAIL_TEMPLATE_TEXT, EMAIL_SUBJECT,
 *      MINIPAY_MINIAPP_ID (Discover listing id → link.minipay.xyz/miniapp?id=), optional MINIPAY_DEEPLINK_BASE override.
 * Re-runs are safe: contacts already sent for this campaign, or unsubscribed, are skipped. Prints counts only, never contacts.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WELCOME_SUBJECT, loadTemplates, resendMailer, runCampaign } from '../src/campaign.js';
import { connect, migrate } from '../src/db.js';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const campaign = flag('--campaign');
if (!campaign) throw new Error('--campaign <slug> is required');
const send = args.includes('--send');
if (send && args.includes('--dry-run')) throw new Error('pick one of --send / --dry-run');
const batchArg = flag('--batch');
const batch = batchArg ? Number(batchArg) : undefined;
if (batch !== undefined && !(Number.isInteger(batch) && batch > 0)) throw new Error('--batch must be a positive integer');

const tplDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://nairaguard.space';
const secret = process.env.UNSUBSCRIBE_SECRET;
if (!secret) throw new Error('UNSUBSCRIBE_SECRET required (must match the agent API)');
if (send && (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)) throw new Error('--send needs RESEND_API_KEY and MAIL_FROM');

const db = await connect();
await migrate(db);
const res = await runCampaign(db, {
  campaign, send, only: flag('--only'), batch, dashboardUrl,
  unsubscribeBaseUrl: process.env.UNSUBSCRIBE_BASE_URL ?? dashboardUrl, unsubscribeSecret: secret,
  from: process.env.MAIL_FROM,
  templates: loadTemplates(
    process.env.EMAIL_TEMPLATE_HTML ?? join(tplDir, 'guardian-welcome.html'),
    process.env.EMAIL_TEMPLATE_TEXT ?? join(tplDir, 'guardian-welcome.txt'),
    process.env.EMAIL_SUBJECT ?? WELCOME_SUBJECT),
  mailer: send ? resendMailer(process.env.RESEND_API_KEY!) : undefined,
  minipayBase: process.env.MINIPAY_DEEPLINK_BASE,
  miniappId: process.env.MINIPAY_MINIAPP_ID,
});
console.log(JSON.stringify({ campaign, ...res }));
process.exit(res.failed > 0 ? 1 : 0);
