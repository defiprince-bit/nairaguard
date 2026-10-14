import { NextResponse } from 'next/server';
import { mockBalances } from '../../../../lib/mock';

export async function GET() {
  return NextResponse.json(mockBalances);
}
