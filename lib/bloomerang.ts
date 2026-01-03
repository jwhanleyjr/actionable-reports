import 'server-only';

const BASE_URL = 'https://api.bloomerang.co';
let apiKey: string | null = null;

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

async function request<T>(path: string, options: RequestInit = {}, retries = 3): Promise<T> {
  const url = `${BASE_URL}${path}`;
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
      const body = await safeReadError(response);
      throw new Error(`Bloomerang request failed (${response.status}): ${body}`);
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
  return request(`/v2/constituents/${accountId}`);
}

export async function getHousehold(householdId: number) {
  return request(`/v2/household/${householdId}`);
}
