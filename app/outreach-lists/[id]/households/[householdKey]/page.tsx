import { notFound } from 'next/navigation';

import { SearchWorkspace } from '../../../../search/page';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OutreachListRecord = {
  id: string;
  name: string;
  goal: string | null;
  stage: string | null;
  description?: string | null;
};

export default async function HouseholdFocusPage({ params }: { params: { id: string; householdKey: string } }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <main style={{ padding: 24 }}>
        <p>Supabase configuration is missing.</p>
      </main>
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: list } = await supabase
    .from('outreach_lists')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<OutreachListRecord>();

  if (!list) {
    notFound();
  }

  const householdKey = decodeURIComponent(params.householdKey);
  const profileUrl = `/api/outreach-lists/${params.id}/households/${encodeURIComponent(householdKey)}`;
  const { data: householdRecord } = await supabase
    .from('outreach_list_households')
    .select('outreach_status')
    .eq('outreach_list_id', params.id)
    .eq('household_key', householdKey)
    .maybeSingle<{ outreach_status?: string | null }>();

  return (
    <SearchWorkspace
      mode="householdFocus"
      profileUrl={profileUrl}
      outreachContext={{
        name: list.name,
        goal: list.goal,
        description: list.description ?? list.stage,
        breadcrumbHref: `/outreach-lists/${list.id}`,
        breadcrumbLabel: 'Back to outreach list',
        householdStatus: householdRecord?.outreach_status ?? 'not_started',
        statusEndpoint: `/api/outreach-lists/${list.id}/households/${encodeURIComponent(householdKey)}/status`,
      }}
    />
  );
}
