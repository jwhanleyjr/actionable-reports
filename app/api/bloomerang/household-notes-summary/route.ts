import { NextRequest, NextResponse } from 'next/server';

import {
  HouseholdNote,
  buildNotesMeta,
  fetchHouseholdNotes,
  selectNotesForSummary,
} from '../notes/service';
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
      error: 'Unable to generate notes summary.',
    }, { status: 500 });
  }
}

async function buildSummary(memberIds: number[], apiKey: string): Promise<SummaryResponse> {
  const notesResult = await fetchHouseholdNotes(memberIds, apiKey);

  if (!notesResult.ok) {
    console.error('Failed to fetch household notes for summary', {
      memberIds,
      requestUrls: notesResult.requestUrls,
    });

    return { ...notesResult, ok: false } as SummaryResponse;
  }

  console.log('Household notes fetched for summary', {
    memberIds,
    fetchedCount: notesResult.notes.length,
    totalFetched: notesResult.notesMeta.totalFetched,
  });

  const selection = selectNotesForSummary(notesResult.notes);
  const usedNotes = selection.selected;

  const notesMeta = {
    ...buildNotesMeta(notesResult.notes),
    usedCount: selection.usedCount,
  };

  const summary = await summarizeWithOpenAI(usedNotes);

  if (!summary.ok) {
    return { ...summary, notesMeta };
  }

  return {
    ok: true,
    notesMeta,
    summary: summary.summary,
  };
}

type SummaryResponse = {
  ok: true;
  notesMeta: ReturnType<typeof buildNotesMeta> & { usedCount: number };
  summary: NotesSummary;
} | {
  ok: false;
  status?: number;
  url?: string;
  error?: string;
  notesMeta?: ReturnType<typeof buildNotesMeta> & { usedCount: number };
};

type NotesSummary = {
  keyPoints: string[];
  recentTimeline: string[];
  suggestedNextSteps: string[];
};

function formatNoteLine(note: HouseholdNote) {
  const date = new Date(note.createdDate);
  const readableDate = Number.isNaN(date.getTime()) ? note.createdDate : date.toISOString().slice(0, 10);
  const author = note.createdName ? ` by ${note.createdName}` : '';
  return `${readableDate}${author}: ${note.note}`;
}

async function summarizeWithOpenAI(notes: HouseholdNote[]): Promise<
  { ok: true; summary: NotesSummary }
  | { ok: false; status?: number; url?: string; error?: string }>
{
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, status: 500, error: 'OPENAI_API_KEY is not configured.' };
  }

  if (!notes.length) {
    return {
      ok: true,
      summary: {
        keyPoints: ['No household notes were found to summarize.'],
        recentTimeline: [],
        suggestedNextSteps: ['Capture a recent interaction note before the next call.'],
      },
    };
  }

  const prompt = [
    'You are assisting a donor caller. Summarize the household notes succinctly.',
    'Return JSON with arrays: keyPoints (5-8 bullets), recentTimeline (3-6 bullets), suggestedNextSteps (1-3 bullets).',
    'Keep the tone concise, friendly, and suitable for a phone call.',
    'Notes to summarize:',
    ...notes.map((note) => `- ${formatNoteLine(note)}`),
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that summarizes donor interaction notes. Only output valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 700,
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
    const parsed = JSON.parse(content) as Partial<NotesSummary>;
    return {
      ok: true,
      summary: {
        keyPoints: parsed.keyPoints ?? [],
        recentTimeline: parsed.recentTimeline ?? [],
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
