import { NextResponse } from 'next/server';
import { mockApprovals } from '../../../../lib/mock';

export async function GET() {
  return NextResponse.json({ items: mockApprovals });
}
