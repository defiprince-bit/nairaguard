/**
 * Launch-email campaign core (used by scripts/send-campaign.ts). Email only, via Resend's REST API.
 * Idempotent per (contact, campaign): a contact with a sent row is never sent again; duplicates of a
 * contact (same normalised email/phone) count as the same person. Never logs contact details.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Db } from './db.js';

/** Optional full MiniPay CTA override (env MINIPAY_DEEPLINK_BASE). Prefer MINIPAY_MINIAPP_ID. */
export type Contact = { id: number; email: string; source: string; from_minipay: boolean };

export type MinipayLinkOpts = { miniappId?: string; deeplinkBase?: string };

/** MiniPay Discover deeplink when we have a listing id; undefined means use the plain dashboard URL. */
export function minipayCta(opts: MinipayLinkOpts = {}): string | undefined {
  if (opts.deeplinkBase?.trim()) return opts.deeplinkBase.trim();
  const id = opts.miniappId?.trim();
  if (id) return `https://link.minipay.xyz/miniapp?id=${encodeURIComponent(id)}`;
  return undefined;
}

/** Hex HMAC over "unsub:<contactId>". */
export function signUnsubscribe(contactId: number, secret: string): string {
  return createHmac('sha256', secret).update(`unsub:${contactId}`).digest('hex');
}

export function verifyUnsubscribeToken(c: string, s: string, secret: string): number | null {
  if (!/^\d{1,18}$/.test(c) || !/^[0-9a-f]{64}$/.test(s)) return null;
  const want = Buffer.from(signUnsubscribe(Number(c), secret), 'hex');
  return timingSafeEqual(want, Buffer.from(s, 'hex')) ? Number(c) : null;
}

export function unsubscribeUrl(baseUrl: string, contactId: number, secret: string): string {
  const u = new URL('/api/waitlist/unsubscribe', baseUrl);
  u.searchParams.set('c', String(contactId));
  u.searchParams.set('s', signUnsubscribe(contactId, secret));
  return u.toString();
}

/** Unsubscribes the contact and every row sharing its normalised contact. Returns rows touched. */
export async function unsubscribe(db: Db, contactId: number, at = new Date()): Promise<number> {
  const r = await db.query(
    `UPDATE waitlist SET unsubscribed_at = COALESCE(unsubscribed_at, $2)
     WHERE contact_key = (SELECT contact_key FROM waitlist WHERE id = $1) RETURNING id`, [contactId, at.toISOString()]);
  return r.rows.length;
}

/**
 * MiniPay signups: Discover deeplink when MINIPAY_MINIAPP_ID (or MINIPAY_DEEPLINK_BASE override) is set;
 * otherwise the plain dashboard /app URL. Everyone else gets /app?connect=1. Always carry utm_*.
 * The deprecated link.minipay.xyz/browse?url= form is never used as a default.
 */
export function ctaUrl(c: Pick<Contact, 'source' | 'from_minipay'>, dashboardUrl: string, campaign: string,
  minipay: MinipayLinkOpts = {}): string {
  const isMiniPay = c.source === 'minipay' || c.from_minipay;
  const u = new URL(isMiniPay ? '/app' : '/app?connect=1', dashboardUrl);
  u.searchParams.set('utm_source', c.source || 'direct');
  u.searchParams.set('utm_medium', 'email');
  u.searchParams.set('utm_campaign', campaign);
  if (!isMiniPay) return u.toString();
  return minipayCta(minipay) ?? u.toString();
}

/**
 * Eligible email contacts: one row per normalised contact (oldest signup wins), skipping any contact whose
 * key is unsubscribed or already has a sent row for this campaign.
 */
export async function selectRecipients(db: Db, campaign: string, opts: { only?: string; limit?: number } = {}) {
  const params: unknown[] = [campaign];
  let only = '';
  if (opts.only) { params.push(`e:${opts.only.trim().toLowerCase()}`); only = `AND w.contact_key = $${params.length}`; }
  params.push(opts.limit ?? 1_000_000);
  const { rows } = await db.query<Contact>(`
    SELECT id, email, source, from_minipay FROM (
      SELECT DISTINCT ON (w.contact_key) w.id::int AS id, btrim(w.email) AS email, w.source, w.from_minipay
      FROM waitlist w
      WHERE w.email IS NOT NULL AND w.consent ${only}
        AND NOT EXISTS (SELECT 1 FROM waitlist u WHERE u.contact_key = w.contact_key AND u.unsubscribed_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM campaign_sends s JOIN waitlist x ON x.id = s.contact_id
                        WHERE s.campaign = $1 AND s.sent_at IS NOT NULL AND x.contact_key = w.contact_key)
      ORDER BY w.contact_key, w.id
    ) t ORDER BY id LIMIT $${params.length}`, params);
  return rows;
}

export const REQUIRED_VARS = ['cta_url', 'unsubscribe_url'] as const;
export type TemplateVars = { cta_url: string; unsubscribe_url: string; first_line?: string };

/** Fills {{var}} placeholders. Throws if a required var is empty or any placeholder would be left over. */
export function render(tpl: string, vars: TemplateVars, escape = false): string {
  for (const k of REQUIRED_VARS) if (!vars[k]) throw new Error(`template variable ${k} is required`);
  const all: Record<string, string> = { first_line: '', ...vars };
  const esc = (s: string) => (escape ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : s);
  const out = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in all ? esc(all[k]!) : m));
  const left = out.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`template has unknown placeholder ${left[0]}`);
  return out;
}

/** Plain-text render; an empty first_line would leave a blank gap, so runs of 3+ newlines collapse to 2. */
export function renderText(tpl: string, vars: TemplateVars): string {
  const out = render(tpl, vars);
  return vars.first_line ? out : out.replace(/(\r?\n){3,}/g, '\n\n');
}

export type Templates = { html: string; text: string; subject: string };
export const loadTemplates = (htmlPath: string, textPath: string, subject: string): Templates =>
  ({ html: readFileSync(htmlPath, 'utf8'), text: readFileSync(textPath, 'utf8'), subject });

export type Mailer = (m: { from: string; to: string; subject: string; html: string; text: string; unsubscribeUrl: string; idempotencyKey: string }) =>
  Promise<{ id: string }>;

/** Resend REST API (https://resend.com/docs/api-reference/emails/send-email). One multipart html+text email. */
export function resendMailer(apiKey: string, fetchImpl: typeof fetch = fetch): Mailer {
  return async (m) => {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotencyKey },
      body: JSON.stringify({
        from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text,
        headers: { 'List-Unsubscribe': `<${m.unsubscribeUrl}>` },
      }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!r.ok || !body.id) throw new Error(`resend ${r.status}: ${body.message ?? 'no id'}`);
    return { id: body.id };
  };
}

export type RunOpts = {
  campaign: string; send: boolean; only?: string; batch?: number;
  dashboardUrl: string; unsubscribeBaseUrl: string; unsubscribeSecret: string; from?: string;
  templates: Templates; mailer?: Mailer; minipayBase?: string; miniappId?: string; now?: () => Date;
};
export type RunResult = { eligible: number; sent: number; failed: number; dryRun: boolean };

export async function runCampaign(db: Db, o: RunOpts): Promise<RunResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(o.campaign)) throw new Error('--campaign must be a slug like launch-2026-11');
  const recipients = await selectRecipients(db, o.campaign, { only: o.only, limit: o.batch });
  const res: RunResult = { eligible: recipients.length, sent: 0, failed: 0, dryRun: !o.send };
  // Render everything first: a broken template throws before anything is sent.
  const msgs = recipients.map((c) => {
    const vars = { cta_url: ctaUrl(c, o.dashboardUrl, o.campaign, { deeplinkBase: o.minipayBase, miniappId: o.miniappId }),
      unsubscribe_url: unsubscribeUrl(o.unsubscribeBaseUrl, c.id, o.unsubscribeSecret), first_line: '' };
    return { c, vars, html: render(o.templates.html, vars, true), text: renderText(o.templates.text, vars) };
  });
  if (!o.send) return res;
  if (!o.mailer || !o.from) throw new Error('--send needs RESEND_API_KEY and MAIL_FROM');
  const now = o.now ?? (() => new Date());
  for (const { c, vars, html, text } of msgs) {
    // Claim the row first; a concurrent or crashed earlier run that already sent leaves sent_at set.
    await db.query(`INSERT INTO campaign_sends (contact_id, campaign) VALUES ($1,$2) ON CONFLICT (contact_id, campaign) DO NOTHING`,
      [c.id, o.campaign]);
    const claimed = await db.query(`SELECT sent_at FROM campaign_sends WHERE contact_id=$1 AND campaign=$2`, [c.id, o.campaign]);
    if ((claimed.rows[0] as { sent_at: unknown } | undefined)?.sent_at) continue;
    try {
      const { id } = await o.mailer({ from: o.from, to: c.email, subject: o.templates.subject, html, text,
        unsubscribeUrl: vars.unsubscribe_url, idempotencyKey: `${o.campaign}-${c.id}` });
      await db.query(`UPDATE campaign_sends SET sent_at=$3, provider_message_id=$4, error=NULL WHERE contact_id=$1 AND campaign=$2`,
        [c.id, o.campaign, now().toISOString(), id]);
      res.sent++;
    } catch (e) {
      await db.query(`UPDATE campaign_sends SET error=$3 WHERE contact_id=$1 AND campaign=$2`,
        [c.id, o.campaign, (e as Error).message.slice(0, 500)]);
      res.failed++;
    }
  }
  return res;
}
