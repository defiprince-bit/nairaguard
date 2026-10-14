import { NextResponse } from 'next/server';
import { mockAgent } from '../../../../lib/mock';

export async function GET() {
  return NextResponse.json(mockAgent);
}
