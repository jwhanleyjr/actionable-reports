import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseAdmin } from '../../../../../../../lib/supabaseAdmin';

const allowedStatuses = new Set(['not_started', 'in_progress', 'complete']);

export async function PUT(request: NextRequest, { params }: { params: { id: string; householdKey: string } }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 500 });
  }

  let payload: { status?: string };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const status = payload.status;

  if (!status || !allowedStatuses.has(status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status value.' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const householdKey = decodeURIComponent(params.householdKey);

  const { data, error } = await supabase
    .from('outreach_list_households')
    .update({ outreach_status: status })
    .eq('outreach_list_id', params.id)
    .eq('household_key', householdKey)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: 'Household not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, status });
}
