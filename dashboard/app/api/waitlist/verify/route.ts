import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const upstream = process.env.AGENT_API_URL;
  if (!upstream) return NextResponse.json({ ok: false, error: 'api_not_configured' }, { status: 503 });
  const r = await fetch(`${upstream}/api/waitlist/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
  return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
