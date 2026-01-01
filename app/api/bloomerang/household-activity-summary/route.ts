import { NextRequest, NextResponse } from 'next/server';

import { buildNotesMeta, fetchHouseholdNotes, selectNotesForSummary } from '../notes/service';
import {
  HouseholdInteraction,
  buildInteractionsMeta,
  fetchAllInteractions,
  filterPersonalInteractions,
  selectInteractionsForSummary,
} from '../interactions/service';
import { getApiKey } from '../utils';

const summaryCache = new Map<string, Promise<SummaryResponse>>();

export async function POST(request: NextRequest) {
  let payload: { memberIds?: unknown };

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid JSON body.',
    }, { status: 400 });
  }

  const memberIds = Array.isArray(payload.memberIds)
    ? Array.from(new Set(payload.memberIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))))
    : [];

  if (!memberIds.length) {
    return NextResponse.json({
      ok: false,
      error: 'memberIds must be a non-empty array of numbers.',
    }, { status: 400 });
  }

  let apiKey: string;

  try {
    apiKey = getApiKey();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'BLOOMERANG_API_KEY is not configured.',
    }, { status: 500 });
  }

  const cacheKey = memberIds.join('|');
  if (summaryCache.has(cacheKey)) {
    const cached = await summaryCache.get(cacheKey)!;
    return NextResponse.json(cached, { status: cached.ok ? 200 : cached.status ?? 502 });
  }

  const summaryPromise = buildSummary(memberIds, apiKey);
  summaryCache.set(cacheKey, summaryPromise);

  try {
    const result = await summaryPromise;
    return NextResponse.json(result, { status: result.ok ? 200 : result.status ?? 502 });
  } catch (error) {
    summaryCache.delete(cacheKey);
    return NextResponse.json({
      ok: false,
      error: 'Unable to generate activity summary.',
    }, { status: 500 });
  }
}

async function buildSummary(memberIds: number[], apiKey: string): Promise<SummaryResponse> {
  const notesResult = await fetchHouseholdNotes(memberIds, apiKey);
  const interactionsResult = await fetchAllInteractions(memberIds, apiKey);

  if (!notesResult.ok) {
    console.error('Failed to fetch household notes for summary', {
      memberIds,
      requestUrls: notesResult.requestUrls,
    });

    return { ...notesResult, ok: false } as SummaryResponse;
  }

  if (!interactionsResult.ok) {
    console.error('Failed to fetch household interactions for summary', {
      memberIds,
      requestUrls: interactionsResult.requestUrls,
    });

    return { ...interactionsResult, ok: false } as SummaryResponse;
  }

  console.log('Household notes fetched for summary', {
    memberIds,
    fetchedCount: notesResult.notes.length,
    totalFetched: notesResult.notesMeta.totalFetched,
  });

  console.log('Household interactions fetched for summary', {
    memberIds,
    fetchedCount: interactionsResult.interactions.length,
    totalFetched: interactionsResult.interactionsMeta.totalFetched,
  });

  const filteredInteractions = filterPersonalInteractions(interactionsResult.interactions);
  const interactionSelection = selectInteractionsForSummary(filteredInteractions);
  const notesSelection = selectNotesForSummary(notesResult.notes);

  const interactionsMeta = {
    ...buildInteractionsMeta(filteredInteractions),
    usedCount: interactionSelection.usedCount,
  };

  const notesMeta = {
    ...buildNotesMeta(notesResult.notes),
    usedCount: notesSelection.usedCount,
  };

  const lastMeaningful = findLastMeaningfulInteraction(filteredInteractions);

  const summary = await summarizeWithOpenAI({
    notes: notesSelection.selected,
    interactions: interactionSelection.selected,
    lastMeaningful,
  });

  if (!summary.ok) {
    return { ...summary, notesMeta, interactionsMeta };
  }

  return {
    ok: true,
    notesMeta,
    interactionsMeta,
    summary: summary.summary,
  };
}

type SummaryResponse = {
  ok: true;
  notesMeta: ReturnType<typeof buildNotesMeta> & { usedCount: number };
  interactionsMeta: ReturnType<typeof buildInteractionsMeta> & { usedCount: number };
  summary: ActivitySummary;
} | {
  ok: false;
  status?: number;
  url?: string;
  error?: string;
  notesMeta?: ReturnType<typeof buildNotesMeta> & { usedCount: number };
  interactionsMeta?: ReturnType<typeof buildInteractionsMeta> & { usedCount: number };
};

type ActivitySummary = {
  keyPoints: string[];
  recentTimeline: string[];
  lastMeaningfulInteraction: { date: string | null; channel: string | null; summary: string | null };
  suggestedNextSteps: string[];
};

type SummaryInputs = {
  notes: { createdDate: string; accountId: number; note: string }[];
  interactions: HouseholdInteraction[];
  lastMeaningful: HouseholdInteraction | null;
};

function findLastMeaningfulInteraction(interactions: HouseholdInteraction[]) {
  if (!interactions.length) {
    return null;
  }

  const sorted = [...interactions].sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());
  return sorted[0];
}

function formatNoteLine(note: { createdDate: string; accountId: number; note: string }) {
  const date = new Date(note.createdDate);
  const readableDate = Number.isNaN(date.getTime()) ? note.createdDate : date.toISOString().slice(0, 10);
  return `${readableDate} (Acct ${note.accountId}): ${note.note}`;
}

function formatInteractionLine(interaction: HouseholdInteraction) {
  const date = new Date(interaction.createdDate);
  const readableDate = Number.isNaN(date.getTime()) ? interaction.createdDate : date.toISOString().slice(0, 10);
  const channel = interaction.channel || 'Interaction';
  const direction = interaction.isInbound === null ? '' : interaction.isInbound ? 'Inbound' : 'Outbound';
  const subjectPart = interaction.subject ? ` | ${interaction.subject}` : '';
  const notePart = interaction.noteText ? ` | Note: ${interaction.noteText}` : '';
  return `${readableDate} [${channel}${direction ? ` - ${direction}` : ''}]${subjectPart}${notePart}`;
}

async function summarizeWithOpenAI(inputs: SummaryInputs): Promise<
  { ok: true; summary: ActivitySummary }
  | { ok: false; status?: number; url?: string; error?: string }>
{
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, status: 500, error: 'OPENAI_API_KEY is not configured.' };
  }

  if (!inputs.notes.length && !inputs.interactions.length) {
    return {
      ok: true,
      summary: {
        keyPoints: ['No household activity was found to summarize.'],
        recentTimeline: [],
        lastMeaningfulInteraction: { date: null, channel: null, summary: null },
        suggestedNextSteps: ['Capture a recent interaction before the next call.'],
      },
    };
  }

  const promptLines = [
    'You are assisting a fundraiser preparing for personal donor calls.',
    'Output JSON with: keyPoints (5-8 bullets), recentTimeline (3-8 bullets), lastMeaningfulInteraction (date, channel, summary), suggestedNextSteps (1-3 bullets).',
    'Emphasize interactions for recency and call prep; include dates and channels for timeline bullets when based on interactions.',
    'Keep tone concise, donor-call friendly, and actionable.',
    'Household interactions to summarize:',
    ...inputs.interactions.map((interaction) => `- ${formatInteractionLine(interaction)}`),
    'Household notes to summarize:',
    ...inputs.notes.map((note) => `- ${formatNoteLine(note)}`),
    inputs.lastMeaningful
      ? `The last meaningful interaction appears to be ${formatInteractionLine(inputs.lastMeaningful)}.`
      : 'No meaningful interaction was found. Please infer if possible.',
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      messages: [
        {
          role: 'system',
          content: 'You summarize donor interactions and notes for callers. Only output valid JSON.',
        },
        { role: 'user', content: promptLines.join('\n') },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      url: 'https://api.openai.com/v1/chat/completions',
      error: await safeReadBodyPreview(response),
    };
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    return { ok: false, status: 502, error: 'OpenAI returned an empty response.' };
  }

  try {
    const parsed = JSON.parse(content) as Partial<ActivitySummary>;
    return {
      ok: true,
      summary: {
        keyPoints: parsed.keyPoints ?? [],
        recentTimeline: parsed.recentTimeline ?? [],
        lastMeaningfulInteraction: parsed.lastMeaningfulInteraction ?? { date: null, channel: null, summary: null },
        suggestedNextSteps: parsed.suggestedNextSteps ?? [],
      },
    };
  } catch (error) {
    return { ok: false, status: 502, error: 'Failed to parse OpenAI response.' };
  }
}

async function safeReadBodyPreview(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500) || 'OpenAI request failed.';
  } catch (error) {
    return 'OpenAI request failed.';
  }
}
