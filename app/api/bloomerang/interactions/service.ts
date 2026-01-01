import 'server-only';

import { fetchJsonWithModes, normalizeBoolean, pickString, readValue } from '../utils';
import { getBloomerangBaseUrl } from '../../../../lib/bloomerangBase';

export type HouseholdInteraction = {
  id: number;
  accountId: number;
  channel: string;
  purpose: string | null;
  subject: string | null;
  isInbound: boolean | null;
  date: string | null;
  createdDate: string;
  createdName: string | null;
  noteText: string | null;
};

export type InteractionsMeta = {
  totalFetched: number;
  newestCreatedDate: string | null;
  oldestCreatedDate: string | null;
};

export type InteractionsResult = {
  ok: true;
  interactions: HouseholdInteraction[];
  interactionsMeta: InteractionsMeta;
  requestUrls: string[];
} | {
  ok: false;
  status?: number;
  url?: string;
  bodyPreview?: string;
  error?: string;
  requestUrls?: string[];
};

export async function fetchAllInteractions(memberIds: number[], apiKey: string): Promise<InteractionsResult> {
  const interactions: HouseholdInteraction[] = [];
  const requestUrls: string[] = [];
  let skip = 0;
  const take = 50;
  const baseUrl = getBloomerangBaseUrl();

  while (true) {
    const url = new URL(`${baseUrl}/interactions`);
    url.searchParams.set('skip', String(skip));
    url.searchParams.set('take', String(take));
    url.searchParams.set('constituent', memberIds.join('|'));
    url.searchParams.set('orderBy', 'CreatedDate');
    url.searchParams.set('orderDirection', 'Desc');

    const response = await fetchJsonWithModes(url, apiKey);
    requestUrls.push(url.toString());

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url: response.url,
        bodyPreview: response.bodyPreview,
        error: response.error,
        requestUrls,
      };
    }

    const pageInteractions = normalizeInteractions(response.data);
    interactions.push(...pageInteractions);

    const resultCount = typeof (response.data as { ResultCount?: unknown })?.ResultCount === 'number'
      ? (response.data as { ResultCount: number }).ResultCount
      : pageInteractions.length;

    if (resultCount < take) {
      break;
    }

    skip += take;
  }

  const interactionsMeta = buildInteractionsMeta(interactions);

  return { ok: true, interactions, interactionsMeta, requestUrls };
}

export function buildInteractionsMeta(interactions: HouseholdInteraction[]): InteractionsMeta {
  if (!interactions.length) {
    return { totalFetched: 0, newestCreatedDate: null, oldestCreatedDate: null };
  }

  const dates = interactions
    .map((interaction) => new Date(interaction.createdDate))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  const newest = dates[0]?.toISOString() ?? null;
  const oldest = dates[dates.length - 1]?.toISOString() ?? null;

  return {
    totalFetched: interactions.length,
    newestCreatedDate: newest,
    oldestCreatedDate: oldest,
  };
}

export function filterPersonalInteractions(interactions: HouseholdInteraction[]) {
  const allowed = ['phone', 'email', 'text', 'inperson', 'in person'];
  const otherKeywordRegex = /(call|text|emailed|met|visited|spoke|talked|follow up|follow-up)/i;

  return interactions.filter((interaction) => {
    const channel = interaction.channel?.trim().toLowerCase();

    if (!channel) {
      return false;
    }

    if (channel === 'massemail' || channel === 'mass email' || channel === 'mass-email') {
      return false;
    }

    if (allowed.includes(channel)) {
      return true;
    }

    if (channel === 'other') {
      return Boolean(interaction.noteText && otherKeywordRegex.test(interaction.noteText));
    }

    return false;
  });
}

export function selectInteractionsForSummary(interactions: HouseholdInteraction[]): { selected: HouseholdInteraction[]; usedCount: number } {
  if (!interactions.length) {
    return { selected: [], usedCount: 0 };
  }

  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const sorted = sortByDate(interactions);
  const recent = sorted.filter((interaction) => {
    const date = new Date(interaction.createdDate);
    return !Number.isNaN(date.getTime()) && date >= twelveMonthsAgo;
  });

  const selected: HouseholdInteraction[] = [];
  const seen = new Set<number>();

  for (const interaction of recent) {
    if (!seen.has(interaction.id)) {
      seen.add(interaction.id);
      selected.push(interaction);
    }
  }

  const highSignalKeywords = ['interested', 'prefers', 'asked', 'building', 'tile', 'follow up', 'follow-up', 'call', 'pledge', 'increase', 'concern'];
  const keywordRegex = new RegExp(highSignalKeywords.join('|'), 'i');

  for (const interaction of sorted) {
    if (selected.length >= 30) {
      break;
    }

    if (seen.has(interaction.id)) {
      continue;
    }

    seen.add(interaction.id);
    selected.push(interaction);
  }

  for (const interaction of sorted) {
    if (seen.has(interaction.id)) {
      continue;
    }

    if (keywordRegex.test([interaction.subject ?? '', interaction.noteText ?? ''].join(' '))) {
      seen.add(interaction.id);
      selected.push(interaction);
    }
  }

  return { selected: sortByDate(selected), usedCount: selected.length };
}

function sortByDate(interactions: HouseholdInteraction[]) {
  return [...interactions].sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());
}

function normalizeInteractions(data: unknown): HouseholdInteraction[] {
  const results = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results
    : Array.isArray((data as { results?: unknown[] })?.results)
      ? (data as { results: unknown[] }).results
      : Array.isArray(data)
        ? data as unknown[]
        : [];

  const normalized: HouseholdInteraction[] = [];

  for (const entry of results) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const id = Number(readValue(record, 'Id') ?? readValue(record, 'id'));
    const accountId = Number(readValue(record, 'AccountId') ?? readValue(record, 'accountId'));
    const channel = pickString(record, ['Channel', 'channel']) ?? '';
    const purpose = pickString(record, ['Purpose', 'purpose']) ?? null;
    const subject = pickString(record, ['Subject', 'subject']) ?? null;
    const isInbound = normalizeBoolean(readValue(record, 'IsInbound') ?? readValue(record, 'isInbound'));
    const date = pickString(record, ['Date', 'date']) ?? null;
    const createdDate = pickString(record, ['AuditTrail.CreatedDate', 'CreatedDate', 'createdDate']) ?? '';
    const createdName = pickString(record, ['AuditTrail.CreatedName', 'AuditTrail.CreatedBy', 'AuditTrail.CreatedUser', 'createdName']) ?? null;
    const noteText = pickString(record, ['Note', 'note']) ?? null;

    if (!Number.isFinite(id) || !createdDate) {
      continue;
    }

    normalized.push({
      id,
      accountId: Number.isFinite(accountId) ? accountId : 0,
      channel,
      purpose,
      subject,
      isInbound,
      date,
      createdDate,
      createdName,
      noteText,
    });
  }

  return normalized;
}
