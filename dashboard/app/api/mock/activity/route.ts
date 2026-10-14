import { NextResponse } from 'next/server';
import { mockActivity } from '../../../../lib/mock';

export async function GET() {
  return NextResponse.json({ items: mockActivity });
}
