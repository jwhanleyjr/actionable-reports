import 'server-only';

import { fetchJsonWithModes, pickString, readValue } from '../utils';

export type HouseholdNote = {
  id: number;
  accountId: number;
  createdDate: string;
  createdName: string | null;
  note: string;
};

export type NotesMeta = {
  totalFetched: number;
  newestCreatedDate: string | null;
  oldestCreatedDate: string | null;
};

export type NotesResult = {
  ok: true;
  notes: HouseholdNote[];
  notesMeta: NotesMeta;
  requestUrls: string[];
} | {
  ok: false;
  status?: number;
  url?: string;
  bodyPreview?: string;
  error?: string;
  requestUrls?: string[];
};

export function getBloomerangBaseUrl() {
  const envBase = process.env.BLOOMERANG_BASE_URL || 'https://api.bloomerang.co/v2';
  return envBase.endsWith('/') ? envBase.slice(0, -1) : envBase;
}

export async function fetchHouseholdNotes(memberIds: number[], apiKey: string): Promise<NotesResult> {
  const notes: HouseholdNote[] = [];
  const requestUrls: string[] = [];
  let skip = 0;
  const take = 50;
  const baseUrl = getBloomerangBaseUrl();

  while (true) {
    const url = new URL(`${baseUrl}/notes`);
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

    const pageNotes = normalizeNotes(response.data);
    notes.push(...pageNotes);

    const resultCount = typeof (response.data as { ResultCount?: unknown })?.ResultCount === 'number'
      ? (response.data as { ResultCount: number }).ResultCount
      : pageNotes.length;

    if (resultCount < take) {
      break;
    }

    skip += take;
  }

  const meta = buildNotesMeta(notes);

  return { ok: true, notes, notesMeta: meta, requestUrls };
}

export function buildNotesMeta(notes: HouseholdNote[]): NotesMeta {
  if (!notes.length) {
    return { totalFetched: 0, newestCreatedDate: null, oldestCreatedDate: null };
  }

  const dates = notes
    .map((note) => new Date(note.createdDate))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  const newest = dates[0]?.toISOString() ?? null;
  const oldest = dates[dates.length - 1]?.toISOString() ?? null;

  return {
    totalFetched: notes.length,
    newestCreatedDate: newest,
    oldestCreatedDate: oldest,
  };
}

export function selectNotesForSummary(notes: HouseholdNote[]): { selected: HouseholdNote[]; usedCount: number } {
  if (!notes.length) {
    return { selected: [], usedCount: 0 };
  }

  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const recentNotes = notes.filter((note) => {
    const date = new Date(note.createdDate);
    return !Number.isNaN(date.getTime()) && date >= twelveMonthsAgo;
  });

  if (notes.length < 20) {
    return { selected: sortByDate(notes), usedCount: notes.length };
  }

  const selectedSet = new Set<number>();
  const selectedNotes: HouseholdNote[] = [];

  for (const note of recentNotes) {
    if (!selectedSet.has(note.id)) {
      selectedSet.add(note.id);
      selectedNotes.push(note);
    }
  }

  const highSignalKeywords = ['call', 'email', 'met', 'prefers', 'interested', 'update', 'prayer', 'concern', 'follow-up'];
  const keywordRegex = new RegExp(highSignalKeywords.join('|'), 'i');

  for (const note of notes) {
    if (selectedNotes.length >= recentNotes.length + 10) {
      break;
    }

    if (selectedSet.has(note.id)) {
      continue;
    }

    if (keywordRegex.test(note.note)) {
      selectedSet.add(note.id);
      selectedNotes.push(note);
    }
  }

  return { selected: sortByDate(selectedNotes), usedCount: selectedNotes.length };
}

function sortByDate(notes: HouseholdNote[]) {
  return [...notes].sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());
}

function normalizeNotes(data: unknown): HouseholdNote[] {
  const results = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results
    : Array.isArray((data as { results?: unknown[] })?.results)
      ? (data as { results: unknown[] }).results
      : Array.isArray(data)
        ? data as unknown[]
        : [];

  const normalized: HouseholdNote[] = [];

  for (const entry of results) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const id = Number(readValue(record, 'Id') ?? readValue(record, 'id'));
    const accountId = Number(readValue(record, 'AccountId') ?? readValue(record, 'accountId'));
    const note = pickString(record, ['Note', 'note']) ?? '';
    const createdDate = pickString(record, ['AuditTrail.CreatedDate', 'CreatedDate', 'Date', 'createdDate']) ?? '';
    const createdName = pickString(record, ['AuditTrail.CreatedName', 'AuditTrail.CreatedBy', 'AuditTrail.CreatedUser', 'createdName']) ?? null;

    if (!Number.isFinite(id) || !createdDate) {
      continue;
    }

    normalized.push({
      id,
      accountId: Number.isFinite(accountId) ? accountId : 0,
      createdDate,
      createdName,
      note,
    });
  }

  return normalized;
}
