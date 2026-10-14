import { NextRequest, NextResponse } from 'next/server';

/** Signed unsubscribe link from campaign emails; forwarded to the agent API, which checks the signature. */
export async function GET(req: NextRequest) {
  const upstream = process.env.AGENT_API_URL;
  if (!upstream) return NextResponse.json({ ok: false, error: 'unsubscribe_unavailable' }, { status: 503 });
  const r = await fetch(`${upstream}/api/waitlist/unsubscribe${req.nextUrl.search}`, { cache: 'no-store' });
  const ok = r.status === 200;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NairaGuard</title><body style="font-family:Arial,sans-serif;background:#0b1f17;color:#fff;padding:40px;text-align:center"><h1>${ok ? "You're unsubscribed" : 'This link is not valid'}</h1><p>${ok ? "You won't get more NairaGuard emails." : 'Please use the latest link from your email.'}</p></body>`;
  return new NextResponse(html, { status: ok ? 200 : r.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
