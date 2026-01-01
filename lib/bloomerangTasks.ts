import 'server-only';

import { getBloomerangBaseUrl } from './bloomerangBase';
import { BloomerangTask, CreateTaskPayload, UpdateTaskPayload } from '../types/bloomerang';
import { buildHeaders, getApiKey, pickNumber, pickString } from '../app/api/bloomerang/utils';

const DEFAULT_TAKE = 50;

class BloomerangRequestError extends Error {
  status?: number;
  bodyPreview?: string;
  url?: string;

  constructor(message: string, options: { status?: number; bodyPreview?: string; url?: string } = {}) {
    super(message);
    this.name = 'BloomerangRequestError';
    this.status = options.status;
    this.bodyPreview = options.bodyPreview;
    this.url = options.url;
  }
}

export async function getActiveTasksForConstituent(constituentId: number) {
  const apiKey = getApiKey();
  const baseUrl = getBloomerangBaseUrl();
  const url = new URL(`${baseUrl}/tasks`);
  url.searchParams.set('skip', '0');
  url.searchParams.set('take', String(DEFAULT_TAKE));
  url.searchParams.set('status', 'Active');
  url.searchParams.set('constituent', String(constituentId));
  url.searchParams.set('orderBy', 'Date');
  url.searchParams.set('orderDirection', 'Desc');

  const result = await requestJson(url, { method: 'GET', headers: buildHeaders('both', apiKey) });
  const tasks = normalizeTasks(result.data);

  return { tasks, data: result.data, url: url.toString(), status: result.status };
}

export async function createTask(payload: CreateTaskPayload, options: { sendNotifications?: boolean } = {}) {
  const apiKey = getApiKey();
  const baseUrl = getBloomerangBaseUrl();
  const url = new URL(`${baseUrl}/task`);

  if (options.sendNotifications !== undefined) {
    url.searchParams.set('sendNotifications', String(options.sendNotifications));
  }

  const body = {
    AccountId: payload.accountId,
    DueDate: payload.dueDate,
    Subject: payload.subject,
    Note: payload.note ?? null,
    Channel: payload.channel ?? null,
    Purpose: payload.purpose ?? null,
    UserId: payload.userId ?? undefined,
  };

  const result = await requestJson(url, {
    method: 'POST',
    headers: withJsonHeaders(buildHeaders('both', apiKey)),
    body: JSON.stringify(body),
  });

  return { task: normalizeTask(result.data), data: result.data, status: result.status, url: url.toString() };
}

export async function updateTask(taskId: number, payload: UpdateTaskPayload, options: { sendNotifications?: boolean } = {}) {
  const apiKey = getApiKey();
  const baseUrl = getBloomerangBaseUrl();
  const url = new URL(`${baseUrl}/task/${taskId}`);

  if (options.sendNotifications !== undefined) {
    url.searchParams.set('sendNotifications', String(options.sendNotifications));
  }

  const body = {
    DueDate: payload.dueDate ?? undefined,
    Subject: payload.subject ?? undefined,
    Note: payload.note ?? undefined,
    Channel: payload.channel ?? undefined,
    Purpose: payload.purpose ?? undefined,
    UserId: payload.userId ?? undefined,
  };

  const result = await requestJson(url, {
    method: 'PUT',
    headers: withJsonHeaders(buildHeaders('both', apiKey)),
    body: JSON.stringify(body),
  });

  return { task: normalizeTask(result.data), data: result.data, status: result.status, url: url.toString() };
}

export async function completeTask(taskId: number) {
  const apiKey = getApiKey();
  const baseUrl = getBloomerangBaseUrl();
  const url = new URL(`${baseUrl}/task/${taskId}/complete`);

  const result = await requestJson(url, {
    method: 'PUT',
    headers: withJsonHeaders(buildHeaders('both', apiKey)),
    body: JSON.stringify({}),
  });

  return { task: normalizeTask(result.data), data: result.data, status: result.status, url: url.toString() };
}

function withJsonHeaders(headers: Headers) {
  headers.set('Content-Type', 'application/json');
  return headers;
}

async function requestJson(url: URL, init: RequestInit) {
  const response = await fetch(url, init);
  const bodyText = await response.text();

  if (!response.ok) {
    throw new BloomerangRequestError('Bloomerang request failed', {
      status: response.status,
      bodyPreview: bodyText.slice(0, 500),
      url: url.toString(),
    });
  }

  try {
    const data = bodyText ? JSON.parse(bodyText) : null;
    return { data, status: response.status };
  } catch (error) {
    throw new BloomerangRequestError('Failed to parse Bloomerang response', {
      status: response.status,
      bodyPreview: bodyText.slice(0, 500),
      url: url.toString(),
    });
  }
}

function normalizeTasks(data: unknown): BloomerangTask[] {
  const results = extractResults(data);
  const tasks: BloomerangTask[] = [];

  for (const entry of results) {
    const task = normalizeTask(entry);
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

function normalizeTask(entry: unknown): BloomerangTask | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = pickNumber(record, ['Id', 'id']);
  const accountId = pickNumber(record, ['AccountId', 'accountId']);
  const subject = pickString(record, ['Subject', 'subject']);
  const dueDate = pickString(record, ['DueDate', 'dueDate', 'Date', 'date']) ?? null;
  const note = pickString(record, ['Note', 'note', 'NoteText', 'noteText']) ?? null;
  const channel = pickString(record, ['Channel', 'channel']) ?? null;
  const purpose = pickString(record, ['Purpose', 'purpose']) ?? null;
  const status = pickString(record, ['Status', 'status']) ?? null;
  const createdDate = pickString(record, ['CreatedDate', 'AuditTrail.CreatedDate', 'createdDate']) ?? null;
  const lastModifiedDate = pickString(record, ['AuditTrail.LastModifiedDate', 'LastModifiedDate', 'lastModifiedDate']) ?? null;
  const ownerUserId = pickNumber(record, ['UserId', 'userId']);

  if (!Number.isFinite(id)) {
    return null;
  }

  return {
    id: id as number,
    accountId: Number.isFinite(accountId) ? (accountId as number) : null,
    dueDate,
    subject: subject ?? null,
    note,
    channel,
    purpose,
    status,
    createdDate,
    lastModifiedDate,
    ownerUserId: Number.isFinite(ownerUserId) ? (ownerUserId as number) : null,
    raw: record,
  };
}

function extractResults(data: unknown): unknown[] {
  if (Array.isArray((data as { Results?: unknown[] })?.Results)) {
    return ((data as { Results: unknown[] }).Results).filter(Boolean);
  }

  if (Array.isArray(data)) {
    return (data as unknown[]).filter(Boolean);
  }

  return [];
}
