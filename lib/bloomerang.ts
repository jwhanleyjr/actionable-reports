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

export { BloomerangRequestError };
