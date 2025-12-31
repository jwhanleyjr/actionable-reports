import 'server-only';

export type HeaderMode = 'both' | 'x-only' | 'auth-only';

export type FetchJsonResult = {
  ok: true;
  url: string;
  status: number;
  contentType: string | null;
  data: unknown;
} | {
  ok: false;
  url: string;
  status?: number;
  contentType?: string | null;
  error?: string;
  bodyPreview?: string;
};

export function getApiKey(): string {
  const apiKey = process.env.BLOOMERANG_API_KEY;

  if (!apiKey) {
    throw new Error('BLOOMERANG_API_KEY is not configured.');
  }

  return apiKey;
}

export function buildHeaders(mode: HeaderMode, apiKey: string) {
  const headers = new Headers();
  headers.set('Accept', 'application/json');

  if (mode === 'both' || mode === 'x-only') {
    headers.set('X-Api-Key', apiKey);
  }

  if (mode === 'both' || mode === 'auth-only') {
    headers.set('Authorization', `ApiKey ${apiKey}`);
  }

  return headers;
}

export async function fetchJsonWithModes(url: URL, apiKey: string): Promise<FetchJsonResult> {
  const modes: HeaderMode[] = ['both', 'x-only', 'auth-only'];

  for (const mode of modes) {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(mode, apiKey),
    });

    const contentType = response.headers.get('content-type');
    const bodyText = await response.text();

    console.log('Bloomerang response', {
      url: url.toString(),
      status: response.status,
      contentType,
      headerMode: mode,
    });

    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && mode !== modes[modes.length - 1]) {
        continue;
      }

      return {
        ok: false,
        url: url.toString(),
        status: response.status,
        contentType,
        bodyPreview: bodyText.slice(0, 300),
      };
    }

    try {
      const data = JSON.parse(bodyText);
      return {
        ok: true,
        url: url.toString(),
        status: response.status,
        contentType,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        url: url.toString(),
        status: response.status,
        contentType,
        error: 'Failed to parse JSON from Bloomerang.',
        bodyPreview: bodyText.slice(0, 300),
      };
    }
  }

  return {
    ok: false,
    url: url.toString(),
    error: 'Unable to complete Bloomerang request.',
  };
}

export function readValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

export function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = readValue(source, key);
    const numeric = typeof value === 'number' ? value : Number(value);

    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

export function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readValue(source, key);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  return null;
}
