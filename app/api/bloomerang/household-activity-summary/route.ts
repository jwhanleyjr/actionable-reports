import { NextRequest, NextResponse } from 'next/server';

import { buildNotesMeta, fetchHouseholdNotes, selectNotesForSummary } from '../notes/service';
import {
  HouseholdInteraction,
  buildInteractionsMeta,
  fetchAllInteractions,
  filterPersonalInteractions,
  selectInteractionsForSummary,
} from '../interactions/service';
import { buildHouseholdGivingInterests, GivingInterest } from '../giving-interests/service';
import { getApiKey } from '../utils';

const summaryCache = new Map<string, Promise<SummaryResponse>>();

export async function POST(request: NextRequest) {
  let payload: { memberIds?: unknown; outreachGoal?: unknown; outreachContext?: unknown };

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
  const outreachGoal = typeof payload.outreachGoal === 'string' ? payload.outreachGoal.trim() : null;
  const outreachContext = typeof payload.outreachContext === 'string' ? payload.outreachContext.trim() : null;

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

  const cacheKey = `${memberIds.join('|')}::${outreachGoal ?? ''}::${outreachContext ?? ''}`;
  if (summaryCache.has(cacheKey)) {
    const cached = await summaryCache.get(cacheKey)!;
    return NextResponse.json(cached, { status: cached.ok ? 200 : cached.status ?? 502 });
  }

  const summaryPromise = buildSummary(memberIds, apiKey, {
    outreachGoal,
    outreachContext,
  });
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

async function buildSummary(
  memberIds: number[],
  apiKey: string,
  outreachInputs: { outreachGoal: string | null; outreachContext: string | null },
): Promise<SummaryResponse> {
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

  const givingInterestsResult = await buildHouseholdGivingInterests(memberIds, apiKey);

  if (!givingInterestsResult.ok) {
    console.error('Failed to derive giving interests for summary', {
      memberIds,
      status: givingInterestsResult.status,
    });
  }

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
    givingInterests: givingInterestsResult.ok ? givingInterestsResult.givingInterests : [],
    outreachGoal: outreachInputs.outreachGoal,
    outreachContext: outreachInputs.outreachContext,
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
  givingInterests: string[];
  recommendedOpeningLine: string;
  suggestedVoicemailMessage: string;
};

type SummaryInputs = {
  notes: { createdDate: string; accountId: number; note: string }[];
  interactions: HouseholdInteraction[];
  lastMeaningful: HouseholdInteraction | null;
  givingInterests: GivingInterest[];
  outreachGoal: string | null;
  outreachContext: string | null;
};

function findLastMeaningfulInteraction(interactions: HouseholdInteraction[]) {
  if (!interactions.length) {
    return null;
  }

  const sorted = [...interactions].sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());
  return sorted[0];
}

function formatNoteLine(note: { createdDate: string; accountId: number; note: string }) {
  const readableDate = formatReadableDate(note.createdDate);
  return `${readableDate} (Acct ${note.accountId}): ${note.note}`;
}

function formatInteractionLine(interaction: HouseholdInteraction) {
  const readableDate = formatReadableDate(interaction.createdDate || interaction.date);
  const channel = interaction.channel || 'Interaction';
  const direction = interaction.isInbound === null ? '' : interaction.isInbound ? 'Inbound' : 'Outbound';
  const subjectPart = interaction.subject ? ` | ${interaction.subject}` : '';
  const notePart = interaction.noteText ? ` | Note: ${interaction.noteText}` : '';
  return `${readableDate} [${channel}${direction ? ` - ${direction}` : ''}]${subjectPart}${notePart}`;
}

function formatReadableDate(value: string | null) {
  if (!value) {
    return 'Unknown date';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function formatInterestLabel(interest: GivingInterest) {
  const parts = [interest.fund, interest.campaign, interest.appeal].filter((part) => part && part.trim()) as string[];
  return parts.join(' → ') || 'General giving';
}

function formatGivingInterestLine(interest: GivingInterest) {
  const label = formatInterestLabel(interest);
  const total = formatUsd(interest.totalAmount);
  const lastGift = interest.lastGiftDate ? formatReadableDate(interest.lastGiftDate) : 'Unknown date';
  return `- ${label} (Total: ${total}; Last: ${lastGift})`;
}

function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function buildGivingInterestBullets(
  interests: GivingInterest[],
  modelBullets: string[] = [],
) {
  const cleanedModel = modelBullets.map((item) => item.trim()).filter(Boolean).slice(0, 6);

  if (cleanedModel.length) {
    return cleanedModel;
  }

  return interests.slice(0, 6).map((interest) => {
    const label = formatInterestLabel(interest);
    const total = formatUsd(interest.totalAmount);
    const lastGift = interest.lastGiftDate ? formatReadableDate(interest.lastGiftDate) : 'most recent gift date unknown';
    return `${label}: total ${total}, last gift ${lastGift}`;
  });
}

function extractInterestSnippet(primary?: string | null, secondary?: string | null) {
  const source = primary?.trim() || secondary?.trim();

  if (!source) {
    return null;
  }

  return source.length > 160 ? `${source.slice(0, 157)}…` : source;
}

function extractOutreachPurpose(inputs: SummaryInputs) {
  const context = inputs.outreachContext?.trim();
  if (context) {
    return context.length > 180 ? `${context.slice(0, 177)}…` : context;
  }

  if (inputs.outreachGoal?.trim()) {
    return `${inputs.outreachGoal.trim()} outreach`;
  }

  return null;
}

function buildRecommendedOpeningLine(inputs: SummaryInputs, provided?: string | null) {
  const topInterest = inputs.givingInterests[0];
  const interestLabel = topInterest ? formatInterestLabel(topInterest) : null;
  const interestSnippet = topInterest && topInterest.lastGiftDate
    ? `${formatInterestLabel(topInterest)} (most recent gift ${formatReadableDate(topInterest.lastGiftDate)})`
    : interestLabel;

  if (provided && provided.trim()) {
    return provided.trim();
  }

  const latestNote = inputs.notes.length
    ? [...inputs.notes].sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())[0]
    : null;

  if (inputs.lastMeaningful) {
    const date = formatReadableDate(inputs.lastMeaningful.createdDate || inputs.lastMeaningful.date);
    const channel = humanizeChannel(inputs.lastMeaningful.channel) || 'recent conversation';
    const interest = extractInterestSnippet(inputs.lastMeaningful.noteText, inputs.lastMeaningful.subject)
      || (latestNote ? extractInterestSnippet(latestNote.note) : null)
      || interestSnippet
      || 'your recent updates';

    return `Great to reconnect after our ${channel} on ${date}. I appreciated hearing about ${interest}—how have things been since?`;
  }

  if (latestNote) {
    const date = formatReadableDate(latestNote.createdDate);
    const interest = extractInterestSnippet(latestNote.note) || interestSnippet || 'your recent updates';
    return `Thanks for sharing on ${date} about ${interest}. I’d love to catch up and hear how things are going.`;
  }

  if (interestLabel) {
    return `Thank you for your continued support for ${interestLabel}. I’d love to connect soon and hear how things are going.`;
  }

  return 'Looking forward to reconnecting and hearing how you have been involved with us recently.';
}

function buildSuggestedVoicemailMessage(inputs: SummaryInputs, provided?: string | null) {
  if (provided && provided.trim()) {
    return provided.trim();
  }

  const purpose = extractOutreachPurpose(inputs);

  if (purpose) {
    return `Hi there, this is a quick voicemail from our team. I wanted to follow up regarding ${purpose}. Please give us a call back when you have a moment.`;
  }

  if (inputs.givingInterests.length) {
    const interestLabel = formatInterestLabel(inputs.givingInterests[0]);
    return `Hi there, this is a quick voicemail from our team. I wanted to share a brief update about ${interestLabel}. Please call us back when you have a moment.`;
  }

  return 'Hi there, this is a quick voicemail from our team. We would love to connect when you have a moment.';
}

function humanizeChannel(channel?: string | null) {
  if (!channel) {
    return null;
  }

  const normalized = channel.toLowerCase();

  if (normalized.includes('phone') || normalized.includes('call')) {
    return 'phone call';
  }

  if (normalized.includes('text')) {
    return 'text exchange';
  }

  if (normalized.includes('email')) {
    return 'email conversation';
  }

  if (normalized.includes('inperson') || normalized.includes('in person')) {
    return 'in-person visit';
  }

  return channel.toLowerCase();
}

async function summarizeWithOpenAI(inputs: SummaryInputs): Promise<
  { ok: true; summary: ActivitySummary }
  | { ok: false; status?: number; url?: string; error?: string }>
{
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, status: 500, error: 'OPENAI_API_KEY is not configured.' };
  }

  if (!inputs.notes.length && !inputs.interactions.length) {
    const interestBullets = buildGivingInterestBullets(inputs.givingInterests);

    return {
      ok: true,
      summary: {
        keyPoints: ['No household activity was found to summarize.'],
        recentTimeline: [],
        lastMeaningfulInteraction: { date: null, channel: null, summary: null },
        suggestedNextSteps: ['Capture a recent interaction before the next call.'],
        givingInterests: interestBullets,
        recommendedOpeningLine: buildRecommendedOpeningLine(inputs, null),
        suggestedVoicemailMessage: buildSuggestedVoicemailMessage(inputs, null),
      },
    };
  }

  const promptLines = [
    'You are assisting a fundraiser preparing for personal donor calls.',
    'Output JSON with: { "keyPoints": [...], "recentTimeline": [...], "lastMeaningfulInteraction": { "date": "...", "channel": "...", "summary": "..." }, "suggestedNextSteps": [...], "givingInterests": [...], "recommendedOpeningLine": "...", "suggestedVoicemailMessage": "..." }.',
    'keyPoints: 5-8 concise bullets. recentTimeline: 3-8 bullets, most recent first, and include date + channel when from interactions. suggestedNextSteps: 1-3 actionable bullets for a phone call.',
    'givingInterests: 3-6 concise bullets in plain language that summarize giving patterns from the provided interests (avoid IDs).',
    'recommendedOpeningLine: 1-2 sentences, natural phone-call opener. Reference the most recent meaningful personal interaction (Phone/Text/Email/InPerson) if present and nod to at least one concrete giving interest when possible. Avoid donation asks. If no meaningful interaction exists, ground the opener in the most recent note or their relationship with the organization—still no money ask.',
    'suggestedVoicemailMessage: 1-3 sentences, concise and warm. Mention the outreach purpose/context if provided, avoid any donation ask, and include a gentle call-back request.',
    'Emphasize interactions for recency and call prep; include dates and channels for timeline bullets when based on interactions.',
    'Keep tone concise, donor-call friendly, and actionable.',
    ...(inputs.outreachGoal ? [`Outreach goal: ${inputs.outreachGoal}`] : []),
    ...(inputs.outreachContext ? [`Outreach context: ${inputs.outreachContext}`] : []),
    ...(inputs.givingInterests.length
      ? ['Giving Interests (derived from transactions):', ...inputs.givingInterests.map(formatGivingInterestLine)]
      : []),
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
    const safeSummary = sanitizeSummary(parsed, inputs);

    return {
      ok: true,
      summary: safeSummary,
    };
  } catch (error) {
    return { ok: false, status: 502, error: 'Failed to parse OpenAI response.' };
  }
}

function sanitizeSummary(summary: Partial<ActivitySummary>, inputs: SummaryInputs): ActivitySummary {
  const toStrings = (value: unknown) =>
    Array.isArray(value)
      ? value
        .map((item) => (typeof item === 'string' ? item.trim() : typeof item === 'number' ? String(item) : null))
        .filter((item): item is string => Boolean(item))
      : [];

  const safeLastMeaningful: ActivitySummary['lastMeaningfulInteraction'] = {
    date: typeof summary.lastMeaningfulInteraction?.date === 'string'
      ? summary.lastMeaningfulInteraction.date
      : null,
    channel: typeof summary.lastMeaningfulInteraction?.channel === 'string'
      ? summary.lastMeaningfulInteraction.channel
      : null,
    summary: typeof summary.lastMeaningfulInteraction?.summary === 'string'
      ? summary.lastMeaningfulInteraction.summary
      : null,
  };

  const opener = typeof summary.recommendedOpeningLine === 'string'
    ? summary.recommendedOpeningLine
    : null;
  const voicemail = typeof summary.suggestedVoicemailMessage === 'string'
    ? summary.suggestedVoicemailMessage
    : null;

  return {
    keyPoints: toStrings(summary.keyPoints),
    recentTimeline: toStrings(summary.recentTimeline),
    lastMeaningfulInteraction: safeLastMeaningful,
    suggestedNextSteps: toStrings(summary.suggestedNextSteps),
    givingInterests: buildGivingInterestBullets(inputs.givingInterests, toStrings(summary.givingInterests)),
    recommendedOpeningLine: buildRecommendedOpeningLine(inputs, opener),
    suggestedVoicemailMessage: buildSuggestedVoicemailMessage(inputs, voicemail),
  };
}

async function safeReadBodyPreview(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500) || 'OpenAI request failed.';
  } catch (error) {
    return 'OpenAI request failed.';
  }
}
