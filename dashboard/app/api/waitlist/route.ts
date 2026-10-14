import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_SOURCES = new Set([
  'x',
  'celo-ng',
  'celo-africa-dao',
  'minipay',
  'whatsapp-freelancers',
  'referral',
]);

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isPhone(v: string) {
  const digits = v.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(digits);
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
    contact,
    consent,
    wallet,
    fromMiniPay,
    source: rawSource,
  } = body as {
    contact?: unknown;
    consent?: unknown;
    wallet?: unknown;
    fromMiniPay?: unknown;
    source?: unknown;
  };

  if (typeof contact !== 'string' || !contact.trim()) {
    return NextResponse.json({ ok: false, error: 'contact_required' }, { status: 400 });
  }
  const trimmed = contact.trim();
  if (!isEmail(trimmed) && !isPhone(trimmed)) {
    return NextResponse.json({ ok: false, error: 'contact_invalid' }, { status: 400 });
  }
  if (consent !== true) {
    return NextResponse.json({ ok: false, error: 'consent_required' }, { status: 400 });
  }
  if (wallet != null && wallet !== '' && (typeof wallet !== 'string' || !isAddress(wallet))) {
    return NextResponse.json({ ok: false, error: 'wallet_invalid' }, { status: 400 });
  }
  if (fromMiniPay != null && typeof fromMiniPay !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'fromMiniPay_invalid' }, { status: 400 });
  }
  if (fromMiniPay === true && (!wallet || typeof wallet !== 'string')) {
    return NextResponse.json({ ok: false, error: 'minipay_wallet_required' }, { status: 400 });
  }

  // source is normalised; we do not persist or log PII in this mock.
  void (typeof rawSource === 'string' && ALLOWED_SOURCES.has(rawSource) ? rawSource : 'direct');

  return NextResponse.json({ ok: true });
}
