import * as XLSX from 'xlsx';

export type ParsedImportRow = {
  accountNumber: string;
  sourceRow: Record<string, unknown>;
};

const ACCOUNT_HEADERS = [
  'account number',
  'accountnumber',
  'account #',
  'account',
  'acct number',
];

function normalizeAccountNumber(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return String(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    return cleaned || null;
  }

  return null;
}

function detectAccountNumberColumn(headers: string[]): number | null {
  const normalized = headers.map((header) => header.trim().toLowerCase());

  for (let i = 0; i < normalized.length; i += 1) {
    if (ACCOUNT_HEADERS.includes(normalized[i])) {
      return i;
    }
  }

  return null;
}

export function parseAccountNumbersFromWorkbook(buffer: ArrayBuffer | Buffer): ParsedImportRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as Array<unknown[]>;

  if (!rows.length) {
    return [];
  }

  const headerRow = rows[0]?.map((cell) => (typeof cell === 'string' ? cell : '')) as string[];
  const headerIndex = detectAccountNumberColumn(headerRow);

  const parsed: ParsedImportRow[] = [];
  const seen = new Set<string>();

  const startIndex = headerIndex !== null ? 1 : 0;
  const accountColumnIndex = headerIndex !== null ? headerIndex : 0;

  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const cellValue = row[accountColumnIndex];
    const accountNumber = normalizeAccountNumber(cellValue);

    if (!accountNumber || seen.has(accountNumber)) {
      continue;
    }

    const sourceRow: Record<string, unknown> = {};

    if (headerIndex !== null) {
      headerRow.forEach((header, index) => {
        if (header) {
          sourceRow[header] = row[index] ?? null;
        }
      });
    } else if (Array.isArray(row)) {
      sourceRow['Column 1'] = row[0] ?? null;
    }

    parsed.push({ accountNumber, sourceRow });
    seen.add(accountNumber);
  }

  return parsed;
}
