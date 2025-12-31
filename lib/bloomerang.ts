import 'server-only';

class BloomerangRequestError extends Error {
  url: string;
  status: number;
  bodySnippet?: string;
  contentType?: string | null;

  constructor(message: string, url: string, status: number, bodySnippet?: string, contentType?: string | null) {
    super(message);
    this.url = url;
    this.status = status;
    this.bodySnippet = bodySnippet;
    this.contentType = contentType;
  }
}

let apiKey: string | null = null;
let baseUrl: string | null = null;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey(): string {
  if (apiKey) {
    return apiKey;
  }

  const envKey = process.env.BLOOMERANG_API_KEY;

  if (!envKey) {
    throw new Error('BLOOMERANG_API_KEY is not set');
  }

  apiKey = envKey;
  return apiKey;
}

function getBaseUrl(): string {
  if (baseUrl) {
    return baseUrl;
  }

  const envBaseUrl = process.env.BLOOMERANG_BASE_URL;

  if (!envBaseUrl) {
    throw new Error('BLOOMERANG_BASE_URL is not set');
  }

  baseUrl = envBaseUrl;
  return baseUrl;
}

async function request<T>(path: string, options: RequestInit = {}, retries = 3): Promise<T> {
  const normalizedBase = getBaseUrl().endsWith('/') ? getBaseUrl() : `${getBaseUrl()}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBase).toString();
  const headers = new Headers(options.headers);
  headers.set('X-API-KEY', getApiKey());
  headers.set('Accept', 'application/json');

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (shouldRetry(response.status, retries)) {
        await sleep(getBackoffDelay(retries));
        return request<T>(path, options, retries - 1);
      }
      const contentType = response.headers.get('content-type');
      const body = await safeReadError(response);
      const snippet = body.slice(0, 300);
      console.error('Bloomerang request failed', {
        url,
        status: response.status,
        contentType,
      });
      throw new BloomerangRequestError(
        `Bloomerang request failed (${response.status}) for ${url}: ${snippet}`,
        url,
        response.status,
        snippet,
        contentType,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (retries > 0 && isNetworkError(error)) {
      await sleep(getBackoffDelay(retries));
      return request<T>(path, options, retries - 1);
    }
    throw error;
  }
}

function isNetworkError(error: unknown): boolean {
  return error instanceof Error;
}

function shouldRetry(status: number, retries: number) {
  return retries > 0 && (status >= 500 || status === 429);
}

function getBackoffDelay(retries: number) {
  const attempt = 4 - retries;
  return Math.min(500 * 2 ** (attempt - 1), 4000);
}

async function safeReadError(response: Response) {
  try {
    return await response.text();
  } catch {
    return response.statusText || 'Unknown error';
  }
}

export async function getConstituent(accountId: number) {
  return request(`/constituent/${accountId}`);
}

export async function getHousehold(householdId: number) {
  return request(`/households/${householdId}`);
}

type ConstituentSearchResult = {
  accountId?: number;
  accountID?: number;
  accountid?: number;
  accountNumber?: number | string;
  constituentId?: number;
  constituentID?: number;
  constituentid?: number;
  id?: number;
  [key: string]: unknown;
};

type ConstituentSearchResponse = {
  items?: ConstituentSearchResult[];
  results?: ConstituentSearchResult[];
} | ConstituentSearchResult[];

function extractSearchResults(response: ConstituentSearchResponse): ConstituentSearchResult[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response?.items)) {
    return response.items;
  }

  if (Array.isArray(response?.results)) {
    return response.results;
  }

  return [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export async function findConstituentIdByAccountNumber(accountNumber: string): Promise<{
  constituentId: number | null;
  url: string;
}> {
  const normalizedBase = getBaseUrl().endsWith('/') ? getBaseUrl() : `${getBaseUrl()}/`;
  const url = new URL('constituents/search', normalizedBase);
  url.searchParams.set('skip', '0');
  url.searchParams.set('take', '1');
  url.searchParams.set('search', accountNumber);

  const searchUrl = url.toString();
  const response = (await request(searchUrl)) as ConstituentSearchResponse;
  const [firstResult] = extractSearchResults(response);

  const candidate = extractConstituentId(firstResult);

  const constituentId = Number.isFinite(candidate) ? (candidate as number) : null;

  if (!constituentId) {
    console.warn('No constituent id found in search response', { searchUrl, firstResult });
  }

  return { constituentId, url: searchUrl };
}

function extractConstituentId(result: ConstituentSearchResult | undefined): number | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const directCandidate =
    toNumber((result as ConstituentSearchResult).constituentId) ??
    toNumber((result as ConstituentSearchResult).constituentID) ??
    toNumber((result as ConstituentSearchResult).constituentid) ??
    toNumber((result as ConstituentSearchResult).accountId) ??
    toNumber((result as ConstituentSearchResult).accountID) ??
    toNumber((result as ConstituentSearchResult).accountid) ??
    toNumber((result as ConstituentSearchResult).id);

  if (directCandidate !== null) {
    return directCandidate;
  }

  const entries = Object.entries(result);
  for (const [key, value] of entries) {
    if (typeof key === 'string' && /constituent.*id/i.test(key)) {
      const numeric = toNumber(value);
      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

export { BloomerangRequestError };
