import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { type Client, formatUnits, isAddress } from 'viem';
import { createSiweMessage, parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import type { Db } from './db.js';
import type { VaultState } from './loop.js';
import { computePnl, getBaseline } from './pnl.js';

/** design.md §4 source allowlist. */
export const WAITLIST_SOURCES = new Set(['x', 'celo-ng', 'celo-africa-dao', 'minipay', 'whatsapp-freelancers', 'referral']);
export const normaliseSource = (s: string | null | undefined) => (s && WAITLIST_SOURCES.has(s) ? s : 'direct');

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

const NONCE_TTL_MS = 10 * 60_000;

export type ApiDeps = {
  db: Db;
  agentAddress: `0x${string}`;
  erc8004Id?: string;
  tokens: { cngn: `0x${string}`; usdt: `0x${string}` };
  /** Live on-chain read for limits; optional (falls back to last logged quote for balances). */
  readState?: (vault: `0x${string}`) => Promise<VaultState>;
  /** SIWE expectations. */
  siwe: { domain: string; uri: string; chainId: number; client: Client };
  /** Agent considered unhealthy when its last ok run is older than this. */
  staleAfterMs?: number;
  now?: () => Date;
};

export type ApiRequest = { method: string; url: string; body?: unknown };
export type ApiResponse = { status: number; body: unknown };

type Money = { token: 'cNGN' | 'USDT'; amount: string; amountNgn: string; amountUsd: string; rate: string; rateAt: string };

function money(token: 'cNGN' | 'USDT', amount: string, rate: number, rateAt: Date | string): Money {
  const units = Number(formatUnits(BigInt(amount), 18));
  const ngn = token === 'cNGN' ? units : units * rate;
  return {
    token, amount, amountNgn: ngn.toFixed(2), amountUsd: (ngn / rate).toFixed(2), rate: String(rate),
    rateAt: new Date(rateAt).toISOString(),
  };
}

const iso = (d: Date | string) => new Date(d).toISOString();
const json = (status: number, body: unknown): ApiResponse => ({ status, body });

export function createApi(d: ApiDeps) {
  const now = () => d.now?.() ?? new Date();
  const sym = (a: string | null): 'cNGN' | 'USDT' =>
    a?.toLowerCase() === d.tokens.cngn.toLowerCase() ? 'cNGN' : 'USDT';

  async function latestQuote(vault: string) {
    const r = await d.db.query<{ rate: string; ngn_balance: string; usd_balance: string; created_at: string }>(
      'SELECT * FROM quotes WHERE vault=$1 ORDER BY created_at DESC, id DESC LIMIT 1', [vault]);
    return r.rows[0];
  }

  async function balances(vault: string) {
    const q = await latestQuote(vault);
    const st = d.readState ? await d.readState(vault as `0x${string}`).catch(() => undefined) : undefined;
    if (!q && !st) return json(404, { error: 'unknown_vault' });
    const rate = Number(q?.rate ?? 0);
    const rateAt = q?.created_at ?? now();
    const ngn = st?.ngnBalance.toString() ?? q!.ngn_balance;
    const usd = st?.usdBalance.toString() ?? q!.usd_balance;
    if (!rate) return json(503, { error: 'no_rate_yet' });
    const bal = [money('cNGN', ngn, rate, rateAt), money('USDT', usd, rate, rateAt)];
    const total = Number(bal[0]!.amountNgn) + Number(bal[1]!.amountNgn);
    const b = await getBaseline(d.db, vault);
    const p = b ? computePnl(b, ngn, usd, rate) : undefined;
    return json(200, {
      balances: bal,
      ngnShareBps: total > 0 ? Math.round((Number(bal[0]!.amountNgn) / total) * 10_000) : 0,
      targetNgnBps: st?.limits.targetNgnBps ?? null,
      pnlNgn: p ? p.pnlNgn.toFixed(2) : '0.00',
      pnlUsd: p ? p.pnlUsd.toFixed(2) : '0.00',
      pnlSince: b ? iso(b.fundedAt) : null,
    });
  }

  async function activity(vault: string) {
    const r = await d.db.query<Record<string, string | null>>(
      `SELECT * FROM activity WHERE lower(vault)=$1 AND kind IN ('swap','deposit','withdraw') ORDER BY created_at DESC, id DESC LIMIT 100`,
      [vault]);
    return json(200, {
      items: r.rows.map((a) => {
        const rate = Number(a.rate ?? 0);
        const at = a.created_at!;
        const outAmt = a.min_out; // TODO(Task 8): actual amountOut from Swapped event
        return {
          id: String(a.id), kind: a.kind, reason: a.reason, txHash: a.tx_hash, status: a.status, at: iso(at),
          in: a.amount_in && rate ? money(sym(a.token_in), a.amount_in, rate, at) : undefined,
          out: outAmt && rate ? money(sym(a.token_out), outAmt, rate, at) : undefined,
          feeNgn: a.fee_ngn, pnlNgn: a.pnl_ngn,
        };
      }),
    });
  }

  async function approvals(vault: string) {
    const r = await d.db.query<Record<string, string>>(
      `SELECT a.*, (SELECT rate FROM quotes q WHERE q.vault=lower(a.vault) ORDER BY q.created_at DESC LIMIT 1) AS rate
       FROM approvals a WHERE lower(a.vault)=$1 AND a.status='pending' AND a.expires_at > $2 ORDER BY a.created_at DESC`,
      [vault, now().toISOString()]);
    return json(200, {
      items: r.rows.map((a) => {
        const rate = Number(a.rate ?? 0) || 1;
        return {
          id: a.onchain_id, reason: a.reason, expiresAt: iso(a.expires_at),
          in: money(sym(a.token_in), a.amount_in, rate, a.created_at),
          minOut: money(sym(a.token_out), a.min_out, rate, a.created_at),
        };
      }),
    });
  }

  async function limits(vault: string) {
    if (!d.readState) return json(503, { error: 'chain_unavailable' });
    const l = (await d.readState(vault as `0x${string}`)).limits;
    return json(200, {
      maxTradeUsd: l.maxTradeUsd.toString(), maxDailyUsd: l.maxDailyUsd.toString(),
      approvalThresholdUsd: l.approvalThresholdUsd.toString(), maxSlippageBps: l.maxSlippageBps, targetNgnBps: l.targetNgnBps,
    });
  }

  async function agent() {
    const r = await d.db.query<{ ran_at: string; ok: boolean }>('SELECT ran_at, ok FROM agent_runs ORDER BY ran_at DESC LIMIT 1');
    const last = r.rows[0];
    const stale = d.staleAfterMs ?? 15 * 60_000;
    return json(200, {
      address: d.agentAddress, erc8004Id: d.erc8004Id,
      lastRunAt: last ? iso(last.ran_at) : null,
      healthy: !!last && last.ok && now().getTime() - new Date(last.ran_at).getTime() < stale,
    });
  }

  /** Issue a one-time SIWE nonce + the exact message fields the wallet must sign. */
  async function nonce(address: string | null) {
    const n = randomBytes(16).toString('hex');
    const issuedAt = now();
    const expirationTime = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    await d.db.query('INSERT INTO waitlist_nonces (nonce, expires_at) VALUES ($1,$2)', [n, expirationTime.toISOString()]);
    const message = address && isAddress(address)
      ? createSiweMessage({
          address, chainId: d.siwe.chainId, domain: d.siwe.domain, uri: d.siwe.uri, version: '1', nonce: n,
          issuedAt, expirationTime, statement: 'Join the NairaGuard waitlist with this wallet.',
        })
      : undefined;
    return json(200, { nonce: n, expiresAt: expirationTime.toISOString(), message });
  }

  /** Join without signing: always stored unverified. */
  async function waitlist(body: unknown, source: string) {
    if (!body || typeof body !== 'object') return json(400, { ok: false, error: 'invalid_body' });
    const b = body as Record<string, unknown>;
    const contact = typeof b.contact === 'string' ? b.contact.trim() : '';
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    const isPhone = /^\+?\d{7,15}$/.test(contact.replace(/[\s()-]/g, ''));
    if (!isEmail && !isPhone) return json(400, { ok: false, error: 'contact_invalid' });
    if (b.consent !== true) return json(400, { ok: false, error: 'consent_required' });
    let wallet: string | null = null;
    if (b.wallet != null && b.wallet !== '') {
      if (typeof b.wallet !== 'string' || !isAddress(b.wallet)) return json(400, { ok: false, error: 'wallet_invalid' });
      wallet = b.wallet.toLowerCase();
    }
    // Any client-sent verified flag is ignored (design.md §4).
    // Secret returned once; only its hash is stored. Required to verify this signup.
    const signupToken = randomBytes(32).toString('hex');
    try {
      await d.db.query(
        `INSERT INTO waitlist (email, phone, wallet_address, verified, from_minipay, source, consent, signup_token_hash)
         VALUES ($1,$2,$3,false,$4,$5,true,$6)`,
        [isEmail ? contact : null, isEmail ? null : contact, wallet, b.fromMiniPay === true, source, hashToken(signupToken)]);
      return json(200, { ok: true, signupToken, verified: false });
    } catch (e) {
      if (/unique|duplicate/i.test((e as Error).message)) return json(409, { ok: false, error: 'already_joined' });
      throw e;
    }
  }

  /** SIWE: prove wallet ownership for an existing signup; only then verified = true. */
  async function verify(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.signupToken !== 'string' || !/^[0-9a-f]{64}$/.test(b.signupToken)) {
      return json(400, { ok: false, error: 'signup_token_required' });
    }
    const tokenHash = hashToken(b.signupToken);
    if (typeof b.message !== 'string' || typeof b.signature !== 'string') return json(400, { ok: false, error: 'siwe_required' });
    let parsed;
    try { parsed = parseSiweMessage(b.message); } catch { return json(400, { ok: false, error: 'siwe_invalid' }); }
    if (!parsed.nonce || !parsed.address || !parsed.expirationTime) return json(400, { ok: false, error: 'siwe_invalid' });
    if (parsed.expirationTime.getTime() <= now().getTime()) return json(401, { ok: false, error: 'siwe_expired' });
    if (parsed.chainId !== d.siwe.chainId) return json(401, { ok: false, error: 'siwe_wrong_chain' });
    const ok = await verifySiweMessage(d.siwe.client, {
      message: b.message, signature: b.signature as `0x${string}`, domain: d.siwe.domain, nonce: parsed.nonce, time: now(),
    }).catch(() => false);
    if (!ok) return json(401, { ok: false, error: 'siwe_bad_signature' });
    const signer = parsed.address.toLowerCase();
    const row = await d.db.query<{ wallet_address: string | null }>(
      'SELECT wallet_address FROM waitlist WHERE signup_token_hash=$1', [tokenHash]);
    if (row.rows.length === 0) return json(404, { ok: false, error: 'signup_not_found' });
    const existing = row.rows[0]!.wallet_address;
    if (existing && existing.toLowerCase() !== signer) return json(409, { ok: false, error: 'wallet_mismatch' });
    // Consume the nonce atomically: one use only, never after expiry.
    const used = await d.db.query(
      `UPDATE waitlist_nonces SET used_at=$2 WHERE nonce=$1 AND used_at IS NULL AND expires_at > $2 RETURNING nonce`,
      [parsed.nonce, now().toISOString()]);
    if (used.rows.length === 0) return json(401, { ok: false, error: 'siwe_nonce_invalid' });
    try {
      const r = await d.db.query(
        `UPDATE waitlist SET wallet_address=$2, verified=true
         WHERE signup_token_hash=$1 AND (wallet_address IS NULL OR lower(wallet_address)=$2) RETURNING id`,
        [tokenHash, signer]);
      if (r.rows.length === 0) return json(409, { ok: false, error: 'wallet_mismatch' });
    } catch (e) {
      if (/unique|duplicate/i.test((e as Error).message)) return json(409, { ok: false, error: 'wallet_already_used' });
      throw e;
    }
    return json(200, { ok: true, verified: true });
  }

  /** Structured log line for waitlist paths. Only the wallet address, never contact details. */
  function logWaitlist(path: string, req: ApiRequest, u: URL, r: ApiResponse) {
    let address: string | undefined = u.searchParams.get('address') ?? undefined;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!address && typeof b.message === 'string') {
      try { address = parseSiweMessage(b.message).address; } catch { /* unparsable */ }
    }
    if (!address && typeof b.wallet === 'string') address = b.wallet;
    const body = (r.body ?? {}) as { error?: string };
    console.log(JSON.stringify({
      evt: 'waitlist', path, status: r.status, error: body.error ?? null,
      address: address?.toLowerCase() ?? null, source: path === '/api/waitlist' ? u.searchParams.get('source') ?? null : undefined,
      hasSignature: path.endsWith('/verify') ? typeof b.signature === 'string' : undefined,
      at: now().toISOString(),
    }));
  }

  async function handle(req: ApiRequest): Promise<ApiResponse> {
    const r = await route(req);
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/\/+$/, '');
    if (p.startsWith('/api/waitlist')) logWaitlist(p, req, u, r);
    return r;
  }

  async function route(req: ApiRequest): Promise<ApiResponse> {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/\/+$/, '');
    const m = p.match(/^\/api\/vault\/(0x[0-9a-fA-F]{40})\/(balances|activity|approvals|limits)$/);
    try {
      if (req.method === 'GET' && m) {
        const v = m[1]!.toLowerCase();
        return await ({ balances, activity, approvals, limits } as const)[m[2] as 'balances'](v);
      }
      if (req.method === 'GET' && p === '/api/agent') return await agent();
      if (req.method === 'GET' && p === '/api/waitlist/nonce') return await nonce(u.searchParams.get('address'));
      if (req.method === 'POST' && p === '/api/waitlist') return await waitlist(req.body, normaliseSource(u.searchParams.get('source')));
      if (req.method === 'POST' && p === '/api/waitlist/verify') return await verify(req.body);
      if (req.method === 'GET' && p === '/healthz') return json(200, { ok: true });
      return json(404, { error: 'not_found' });
    } catch (e) {
      console.error('api error:', (e as Error).message); // never log request bodies (PII)
      return json(500, { error: 'internal' });
    }
  }

  return { handle };
}

/** Plain node:http server around the handler, with CORS for the dashboard origin. */
export function serve(api: ReturnType<typeof createApi>, port: number, corsOrigin: string) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    let body: unknown;
    if (req.method === 'POST') {
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 16_000) return void res.writeHead(413).end(); }
      try { body = JSON.parse(raw || 'null'); } catch { return void res.writeHead(400).end('{"error":"invalid_json"}'); }
    }
    const r = await api.handle({ method: req.method ?? 'GET', url: req.url ?? '/', body });
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
  });
  server.listen(port);
  return server;
}
