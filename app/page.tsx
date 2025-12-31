import CampaignDashboard from './components/CampaignDashboard';

import { createCampaign, listCampaigns, usingMockStorage } from '@/lib/dataStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

async function loadCampaigns() {
  try {
    if (usingMockStorage()) {
      if (listCampaigns().length === 0) {
        createCampaign('Sample campaign (mocked)');
      }

      return { campaigns: listCampaigns(), error: null };
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return { campaigns: [], error: 'Unable to load campaigns right now.' };
    }

    const campaigns = (data || []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name || `Campaign #${campaign.id}`,
      createdAt: campaign.created_at ?? undefined,
    }));

    return { campaigns, error: null };
  } catch (loadError) {
    console.error('Campaign preload failed', loadError);
    return { campaigns: [], error: 'Unable to load campaigns right now.' };
  }
}

export default async function Home() {
  const { campaigns, error } = await loadCampaigns();

  return <CampaignDashboard initialCampaigns={campaigns} initialError={error} />;
}
