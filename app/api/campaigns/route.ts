import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to load campaigns.' }, { status: 500 });
    }

    const campaigns = (data || []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name || `Campaign #${campaign.id}`,
      createdAt: campaign.created_at ?? undefined,
    }));

    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error('Campaign list failed', error);
    return NextResponse.json({ error: 'Unable to load campaigns.' }, { status: 500 });
  }
}
