import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({
    ok: true,
    outreachListId: params.id,
    status: 'pending',
    message: 'Notes enrichment placeholder. Fetch and summarize recent notes in a follow-up iteration.',
  });
}
