import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Supabase configuration is missing.' },
      { status: 500 }
    );
  }

  const { error } = await supabase
    .from('outreach_lists')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', params.id)
    .is('archived_at', null);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.redirect(new URL(`/outreach-lists/${params.id}`, request.nextUrl.origin));
}
