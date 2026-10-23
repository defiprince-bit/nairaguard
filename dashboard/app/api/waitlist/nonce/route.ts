import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const upstream = process.env.WAITLIST_API_URL ?? process.env.AGENT_API_URL;
  if (!upstream) return NextResponse.json({ error: 'api_not_configured' }, { status: 503 });
  const r = await fetch(`${upstream}/api/waitlist/nonce${req.nextUrl.search}`, { cache: 'no-store' });
  return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
