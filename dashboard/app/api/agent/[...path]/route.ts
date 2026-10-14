import { NextRequest, NextResponse } from 'next/server';
import { mockActivity, mockAgent, mockApprovals, mockBalances } from '../../../../lib/mock';

/** Read-only proxy to the agent API (AGENT_API_URL). Only /agent and /vault/<addr>/<balances|activity|approvals|limits>. */
const ALLOWED = /^(agent|vault\/0x[0-9a-fA-F]{40}\/(balances|activity|approvals|limits|status))$/;

function mock(path: string) {
  if (path === 'agent') return mockAgent;
  if (path.endsWith('/balances')) return { ...mockBalances, pnlNgn: '12500.00', pnlUsd: '7.89', pnlSince: new Date(Date.now() - 3 * 864e5).toISOString() };
  if (path.endsWith('/activity')) return { items: mockActivity, nextCursor: null };
  if (path.endsWith('/status')) return { vault: path.split('/')[1], lastCheckedAt: new Date(Date.now() - 2 * 60_000).toISOString(), ok: true };
  if (path.endsWith('/approvals')) return { items: mockApprovals };
  if (path.endsWith('/limits')) {
    const e = (n: number) => (BigInt(n) * 10n ** 18n).toString();
    return { maxTradeUsd: e(100), maxDailyUsd: e(500), approvalThresholdUsd: e(50), maxSlippageBps: 100, targetNgnBps: 5000 };
  }
  return null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join('/');
  if (!ALLOWED.test(path)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const upstream = process.env.AGENT_API_URL;
  if (!upstream) {
    // Dev fallback only: mock data when nothing is configured locally.
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json(mock(path), { headers: { 'x-nairaguard-mock': '1' } });
    }
    return NextResponse.json({ error: 'api_not_configured' }, { status: 503 });
  }
  try {
    // Forward only the paging params.
    const q = new URLSearchParams();
    for (const k of ['cursor', 'limit']) {
      const v = req.nextUrl.searchParams.get(k);
      if (v) q.set(k, v);
    }
    const qs = q.toString() ? `?${q}` : '';
    const r = await fetch(`${upstream.replace(/\/+$/, '')}/api/${path}${qs}`, { cache: 'no-store' });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ error: 'upstream_unreachable' }, { status: 502 });
  }
}
