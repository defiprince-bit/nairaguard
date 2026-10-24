import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.js';
import { type Mailer, runCampaign, WELCOME_CAMPAIGN, WELCOME_SUBJECT, loadTemplates } from './campaign.js';
import { type Db, migrate } from './db.js';
import { welcomeConfigFromEnv, welcomeSender } from './welcome.js';

let db: Db;
let sent: Parameters<Mailer>[0][];
const mailer: Mailer = async (m) => { sent.push(m); return { id: `re_${sent.length}` }; };
const cfg = { from: 'NairaGuard <hello@nairaguard.space>', unsubscribeSecret: 's', dashboardUrl: 'https://nairaguard.space', mailer };
beforeEach(async () => { db = new PGlite() as unknown as Db; await migrate(db); sent = []; });

const api = (onSignup?: (e: string) => Promise<unknown>) => createApi({
  db, agentAddress: '0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4', tokens: { cngn: '0x0000000000000000000000000000000000000001', usdt: '0x0000000000000000000000000000000000000002' },
  siwe: { domain: 'nairaguard.space', uri: 'https://nairaguard.space', chainId: 42220, client: {} as never }, onSignup,
});
const flush = () => new Promise((r) => setTimeout(r, 50));

describe('welcome email config', () => {
  it('is off by default and when vars are missing', () => {
    expect(welcomeConfigFromEnv({})).toBeNull();
    expect(welcomeConfigFromEnv({ WELCOME_EMAIL_ENABLED: 'false', RESEND_API_KEY: 'k', MAIL_FROM: 'a', UNSUBSCRIBE_SECRET: 's' })).toBeNull();
    expect(welcomeConfigFromEnv({ WELCOME_EMAIL_ENABLED: 'true', MAIL_FROM: 'a', UNSUBSCRIBE_SECRET: 's' })).toBeNull();
    expect(welcomeConfigFromEnv({ WELCOME_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'k', MAIL_FROM: 'a', UNSUBSCRIBE_SECRET: 's' })).not.toBeNull();
  });
});

describe('welcome on signup', () => {
  it('sends once to the new signup only, with unsubscribe link + header and no launch wording', async () => {
    await db.query(`INSERT INTO waitlist (email, source, consent) VALUES ('old@x.io','x',true)`);
    const a = api(welcomeSender(db, cfg));
    expect((await a.handle({ method: 'POST', url: '/api/waitlist', body: { email: 'New@X.io', consent: true } })).status).toBe(200);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('New@X.io');
    expect(sent[0]!.subject).toBe(WELCOME_SUBJECT);
    expect(sent[0]!.text).toContain('/api/waitlist/unsubscribe?c=');
    expect(sent[0]!.unsubscribeUrl).toContain('/api/waitlist/unsubscribe?c=');
    expect(sent[0]!.text).not.toMatch(/deposits are open|is live/i);
    // Same slug as the backfill: a later one-time run skips this contact.
    await welcomeSender(db, cfg)('new@x.io');
    expect(sent).toHaveLength(1);
  });
  it('no hook → no email; failures never break signup', async () => {
    expect((await api().handle({ method: 'POST', url: '/api/waitlist', body: { email: 'a@x.io', consent: true } })).status).toBe(200);
    const boom = api(async () => { throw new Error('resend down'); });
    expect((await boom.handle({ method: 'POST', url: '/api/waitlist', body: { email: 'b@x.io', consent: true } })).status).toBe(200);
  });
});

describe('retired launch campaign', () => {
  it('refuses launch-* slugs even as a dry run', async () => {
    const t = loadTemplates('templates/guardian-welcome.html', 'templates/guardian-welcome.txt', WELCOME_SUBJECT);
    await expect(runCampaign(db, { campaign: 'launch-2026-10', send: false, dashboardUrl: 'https://x', unsubscribeBaseUrl: 'https://x', unsubscribeSecret: 's', templates: t }))
      .rejects.toThrow(/retired/);
    expect(WELCOME_CAMPAIGN).toBe('guardian-welcome-2026-10');
  });
});
