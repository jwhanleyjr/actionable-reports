import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({
    ok: true,
    outreachListId: params.id,
    status: 'pending',
    message: 'Giving enrichment pipeline placeholder. Implement aggregation of transactions and interests.',
  });
}
