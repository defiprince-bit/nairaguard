import { NextRequest, NextResponse } from 'next/server';
// Single source of truth shared with the agent API (agent/src/waitlistSources.ts).
import { normaliseSource } from '../../../../agent/src/waitlistSources';


function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isAddress(v: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export async function POST(req: NextRequest) {
  // When the agent API is deployed, forward there (it persists + handles SIWE verify).
  const upstream = process.env.AGENT_API_URL;
  if (upstream) {
    const r = await fetch(`${upstream}/api/waitlist${req.nextUrl.search}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await req.text(),
    });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const {
    email: rawEmail,
    contact,
    consent,
    wallet,
    fromMiniPay,
    source: rawSource,
  } = body as {
    email?: unknown;
    contact?: unknown;
    consent?: unknown;
    wallet?: unknown;
    fromMiniPay?: unknown;
    source?: unknown;
  };

  // Email required; wallet optional.
  const email = typeof rawEmail === 'string' ? rawEmail : contact;
  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ ok: false, error: 'email_required' }, { status: 400 });
  }
  if (!isEmail(email.trim())) {
    return NextResponse.json({ ok: false, error: 'email_invalid' }, { status: 400 });
  }
  if (consent !== true) {
    return NextResponse.json({ ok: false, error: 'consent_required' }, { status: 400 });
  }
  if (wallet != null && wallet !== '' && (typeof wallet !== 'string' || !isAddress(wallet.trim()))) {
    return NextResponse.json({ ok: false, error: 'wallet_invalid' }, { status: 400 });
  }
  if (fromMiniPay != null && typeof fromMiniPay !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'fromMiniPay_invalid' }, { status: 400 });
  }

  // source is normalised; we do not persist or log PII in this mock.
  void normaliseSource(rawSource);

  return NextResponse.json({ ok: true });
}
