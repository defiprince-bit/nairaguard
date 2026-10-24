/**
 * Guardian welcome email, sent right after a new waitlist signup (email + consent). Off unless WELCOME_EMAIL_ENABLED=true.
 * Reuses the campaign path (same slug as the one-time backfill), so each contact gets it at most once, unsubscribed
 * contacts are skipped, and every send is recorded in campaign_sends.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Mailer, WELCOME_CAMPAIGN, WELCOME_SUBJECT, loadTemplates, resendMailer, runCampaign } from './campaign.js';
import type { Db } from './db.js';

export type WelcomeConfig = { from: string; unsubscribeSecret: string; dashboardUrl: string; unsubscribeBaseUrl?: string; mailer: Mailer };

const truthy = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

/** Reads env. Null (feature off) unless the flag is on AND every required var is set. Never logs values. */
export function welcomeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WelcomeConfig | null {
  if (!truthy(env.WELCOME_EMAIL_ENABLED)) return null;
  const missing = ['RESEND_API_KEY', 'MAIL_FROM', 'UNSUBSCRIBE_SECRET'].filter((k) => !env[k]);
  if (missing.length) { console.warn(`welcome email disabled: missing ${missing.join(', ')}`); return null; }
  const dashboardUrl = env.DASHBOARD_URL ?? 'https://nairaguard.space';
  return { from: env.MAIL_FROM!, unsubscribeSecret: env.UNSUBSCRIBE_SECRET!, dashboardUrl,
    unsubscribeBaseUrl: env.UNSUBSCRIBE_BASE_URL ?? dashboardUrl, mailer: resendMailer(env.RESEND_API_KEY!) };
}

const tplDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Returns the onSignup hook: sends the welcome to exactly this one contact. */
export function welcomeSender(db: Db, c: WelcomeConfig, templates = loadTemplates(join(tplDir, 'guardian-welcome.html'), join(tplDir, 'guardian-welcome.txt'), WELCOME_SUBJECT)) {
  return async (email: string) => {
    const r = await runCampaign(db, { campaign: WELCOME_CAMPAIGN, send: true, only: email, batch: 1, dashboardUrl: c.dashboardUrl,
      unsubscribeBaseUrl: c.unsubscribeBaseUrl ?? c.dashboardUrl, unsubscribeSecret: c.unsubscribeSecret, from: c.from,
      templates, mailer: c.mailer });
    return r;
  };
}
