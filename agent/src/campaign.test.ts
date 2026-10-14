import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi, WAITLIST_SOURCES as API_SOURCES } from './api.js';
import {
  ctaUrl, loadTemplates, type Mailer, render, renderText, runCampaign, selectRecipients, unsubscribeUrl,
} from './campaign.js';
import { type Db, migrate } from './db.js';
import { assertAgentUri } from './erc8004.js';
import { WAITLIST_SOURCE_LIST, WAITLIST_SOURCES } from './waitlistSources.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = 'test-secret';
const DASH = 'https://nairaguard.app';
const tpl = loadTemplates(join(root, 'agent/templates/launch-email.html'), join(root, 'agent/templates/launch-email.txt'), 'Deposits are open');
let db: Db;
let sent: Parameters<Mailer>[0][];
const mailer: Mailer = async (m) => { sent.push(m); return { id: `re_${sent.length}` }; };
const run = (o: Partial<Parameters<typeof runCampaign>[1]> = {}) => runCampaign(db, {
  campaign: 'launch', send: true, dashboardUrl: DASH, unsubscribeBaseUrl: DASH, unsubscribeSecret: SECRET,
  from: 'NairaGuard <hi@nairaguard.app>', templates: tpl, mailer, ...o,
});
const add = (email: string | null, source = 'x', phone: string | null = null, fromMiniPay = false) => db.query(
  `INSERT INTO waitlist (email, phone, source, consent, from_minipay) VALUES ($1,$2,$3,true,$4) RETURNING id`,
  [email, phone, source, fromMiniPay]).then((r) => Number((r.rows[0] as { id: number }).id));

beforeEach(async () => { db = new PGlite() as unknown as Db; await migrate(db); sent = []; });

describe('waitlist sources', () => {
  it('one shared list, including valora, used by the agent API', () => {
    expect(WAITLIST_SOURCE_LIST).toContain('valora');
    expect(API_SOURCES).toBe(WAITLIST_SOURCES);
  });
  it('dashboard route imports the shared module and has no list of its own', () => {
    const src = readFileSync(join(root, 'dashboard/app/api/waitlist/route.ts'), 'utf8');
    expect(src).toMatch(/from '(\.\.\/)+agent\/src\/waitlistSources'/);
    for (const s of ['celo-ng', 'celo-africa-dao', 'whatsapp-freelancers', 'referral', 'valora']) expect(src).not.toContain(`'${s}'`);
    expect(src).not.toMatch(/new Set\(\s*\[/);
  });
});

describe('templates', () => {
  const vars = { cta_url: 'https://a.example/app?connect=1&utm_source=x', unsubscribe_url: 'https://a.example/u?c=1&s=ab' };
  it('renders html and text with no {{...}} left over', () => {
    const html = render(tpl.html, vars, true);
    const text = renderText(tpl.text, vars);
    expect(html).not.toMatch(/\{\{|\}\}/);
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(html).toContain('href="https://a.example/app?connect=1&amp;utm_source=x"');
    expect(text).toContain(vars.unsubscribe_url);
  });
  it('throws before sending when a required variable is missing', () => {
    expect(() => render(tpl.html, { ...vars, cta_url: '' })).toThrow(/cta_url/);
    expect(() => render(tpl.text, { cta_url: 'x' } as never)).toThrow(/unsubscribe_url/);
  });
  it('collapses 3+ newlines to 2 in text when first_line is empty', () => {
    const text = renderText(tpl.text, vars);
    expect(text).not.toMatch(/\n{3,}/);
    expect(renderText('A\n{{first_line}}\n\nB {{cta_url}} {{unsubscribe_url}}', vars)).toBe(`A\n\nB ${vars.cta_url} ${vars.unsubscribe_url}`);
    expect(renderText('A\n{{first_line}}\n\nB {{cta_url}} {{unsubscribe_url}}', { ...vars, first_line: 'Hi' })).toContain('A\nHi\n\nB');
  });
});

describe('links', () => {
  it('MiniPay deep link for minipay, /app?connect=1 otherwise, both with utm_source', () => {
    const mp = ctaUrl({ source: 'minipay', from_minipay: true }, DASH, 'launch');
    expect(mp.startsWith('https://link.minipay.xyz/browse?url=')).toBe(true);
    expect(decodeURIComponent(mp.split('url=')[1]!)).toBe(`${DASH}/app?utm_source=minipay&utm_medium=email&utm_campaign=launch`);
    expect(ctaUrl({ source: 'valora', from_minipay: false }, DASH, 'launch'))
      .toBe(`${DASH}/app?connect=1&utm_source=valora&utm_medium=email&utm_campaign=launch`);
  });
});

describe('send-campaign', () => {
  it('dry run sends nothing and writes nothing', async () => {
    await add('a@x.io');
    expect(await run({ send: false, mailer: undefined })).toMatchObject({ eligible: 1, sent: 0, dryRun: true });
    expect((await db.query('SELECT * FROM campaign_sends')).rows).toHaveLength(0);
  });
  it('is idempotent: a re-run sends nobody twice and records the provider id', async () => {
    await add('a@x.io'); await add('b@x.io');
    expect(await run()).toMatchObject({ sent: 2 });
    expect(await run()).toMatchObject({ eligible: 0, sent: 0 });
    expect(sent).toHaveLength(2);
    const { rows } = await db.query<{ provider_message_id: string; sent_at: unknown }>('SELECT * FROM campaign_sends ORDER BY id');
    expect(rows.map((r) => r.provider_message_id)).toEqual(['re_1', 're_2']);
    expect(sent[0]!.text).toContain('Unsubscribe: https://nairaguard.app/api/waitlist/unsubscribe?c=');
  });
  it('a failed send is retried on the next run; a different campaign is independent', async () => {
    await add('a@x.io');
    expect(await run({ mailer: async () => { throw new Error('boom'); } })).toMatchObject({ failed: 1 });
    expect(await run()).toMatchObject({ sent: 1 });
    expect(await run({ campaign: 'other' })).toMatchObject({ sent: 1 });
  });
  it('dedupes by normalised email (and phone)', async () => {
    await add('Ada@X.io'); await add(' ada@x.io ', 'valora'); await add(null, 'x', '0803 123 4567'); await add(null, 'x', '+2348031234567');
    const keys = (await db.query<{ contact_key: string }>('SELECT DISTINCT contact_key FROM waitlist')).rows;
    expect(keys).toHaveLength(2);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(sent[0]!.to).toBe('Ada@X.io');
    expect(await run()).toMatchObject({ eligible: 0 });
  });
  it('--only and --batch limit who gets it', async () => {
    await add('a@x.io'); await add('b@x.io'); await add('c@x.io');
    expect(await run({ only: 'B@x.io' })).toMatchObject({ sent: 1 });
    expect(sent[0]!.to).toBe('b@x.io');
    expect(await run({ batch: 1 })).toMatchObject({ sent: 1 });
    expect((await selectRecipients(db, 'launch')).length).toBe(1);
  });
  it('skips unsubscribed contacts, via the signed link, including duplicates', async () => {
    const id = await add('a@x.io'); await add('A@x.io', 'valora'); await add('b@x.io');
    const api = createApi({ db, unsubscribeSecret: SECRET } as never);
    const link = new URL(unsubscribeUrl(DASH, id, SECRET));
    const bad = await api.handle({ method: 'GET', url: `/api/waitlist/unsubscribe?c=${id}&s=${'0'.repeat(64)}` });
    expect(bad.status).toBe(400);
    const ok = await api.handle({ method: 'GET', url: link.pathname + link.search });
    expect(ok).toMatchObject({ status: 200, body: { ok: true } });
    expect(await run()).toMatchObject({ sent: 1 });
    expect(sent.map((m) => m.to)).toEqual(['b@x.io']);
  });
  it('unsubscribe route is off without a secret', async () => {
    const r = await createApi({ db } as never).handle({ method: 'GET', url: '/api/waitlist/unsubscribe?c=1&s=x' });
    expect(r.status).toBe(503);
  });
});

describe('agentURI guard', () => {
  it('refuses vercel.app and host mismatch', () => {
    expect(() => assertAgentUri('https://nairaguard-vert.vercel.app/agent.json', 'https://nairaguard-vert.vercel.app')).toThrow(/vercel\.app/);
    expect(() => assertAgentUri('https://nairaguard.app/agent.json', 'https://www.nairaguard.app')).toThrow(/differs/);
    expect(() => assertAgentUri('https://nairaguard.app/agent.json', undefined)).toThrow(/DASHBOARD_URL/);
    expect(() => assertAgentUri('https://nairaguard.app/.well-known/agent.json', 'https://nairaguard.app')).not.toThrow();
  });
});
