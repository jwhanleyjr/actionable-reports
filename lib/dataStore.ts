import { randomUUID } from 'crypto';

export type CampaignRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type ImportRowRecord = {
  campaignId: string;
  accountId: number;
};

export type HouseholdRecord = {
  householdId: number;
  data: Record<string, unknown> | null;
};

export type HouseholdMemberRecord = {
  householdId: number;
  memberAccountId: number;
};

export type ConstituentRecord = {
  accountId: number;
  data: Record<string, unknown> | null;
};

const campaigns: CampaignRecord[] = [];
const importRows: ImportRowRecord[] = [];
const campaignHouseholds = new Map<
  string,
  { households: HouseholdRecord[]; members: HouseholdMemberRecord[]; constituents: ConstituentRecord[] }
>();

let nextCampaignId = 1;
let nextHouseholdId = 1;

export function usingMockStorage(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function createCampaign(name: string): CampaignRecord {
  const campaign = { id: randomUUID(), name, createdAt: new Date().toISOString() };
  campaigns.unshift(campaign);
  return campaign;
}

export function listCampaigns(): CampaignRecord[] {
  return [...campaigns];
}

export function addImportRows(campaignId: string, accountIds: number[]): void {
  for (const accountId of accountIds) {
    importRows.push({ campaignId, accountId });
  }
}

export function getCampaignAccountIds(campaignId: string): number[] {
  return importRows
    .filter((row) => row.campaignId === campaignId)
    .map((row) => row.accountId)
    .filter((value, index, array) => array.indexOf(value) === index);
}

export function findCampaign(campaignId: string): CampaignRecord | undefined {
  return campaigns.find((campaign) => campaign.id === campaignId);
}

function randomPhone(seed: number): string {
  const area = 300 + (seed % 500);
  const prefix = 100 + ((seed * 7) % 800);
  const line = 1000 + ((seed * 13) % 9000);
  return `${area}-${prefix}-${line}`;
}

function buildMockCampaignData(accountIds: number[]) {
  const households: HouseholdRecord[] = [];
  const members: HouseholdMemberRecord[] = [];
  const constituents: ConstituentRecord[] = [];

  for (let index = 0; index < accountIds.length; index++) {
    const accountId = accountIds[index];
    // Group members in pairs to form households.
    const householdId = nextHouseholdId + Math.floor(index / 2);

    if (!households.some((household) => household.householdId === householdId)) {
      households.push({
        householdId,
        data: {
          householdName: `Household ${householdId}`,
          phoneNumbers: [randomPhone(householdId), randomPhone(householdId + 1)],
        },
      });
    }

    members.push({ householdId, memberAccountId: accountId });
    constituents.push({
      accountId,
      data: {
        fullName: `Constituent ${accountId}`,
        phoneNumbers: [randomPhone(accountId)],
      },
    });
  }

  nextHouseholdId += Math.ceil(accountIds.length / 2);

  return { households, members, constituents };
}

export function getCampaignHouseholds(campaignId: string, accountIds: number[]) {
  if (!campaignHouseholds.has(campaignId)) {
    campaignHouseholds.set(campaignId, buildMockCampaignData(accountIds));
  }

  return campaignHouseholds.get(campaignId) ?? { households: [], members: [], constituents: [] };
}
