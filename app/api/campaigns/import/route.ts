import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

import { addImportRows, createCampaign, usingMockStorage } from '@/lib/dataStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

type ImportCounts = {
  totalRowsSeen: number;
  importedCount: number;
  skippedMissingAccountNumber: number;
  skippedInvalidAccountNumber: number;
};

type ParsedRow = { accountId: number; rowNumber: number };

class MissingAccountNumberColumnError extends Error {}

function isAccountHeader(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const normalized = value.replace(/[^a-z0-9#]+/gi, '').toLowerCase();

  return [
    'accountnumber',
    'account#',
    'acctnumber',
    'accountno',
  ].includes(normalized);
}

function parseWorksheet(buffer: ArrayBuffer): { accountRows: ParsedRow[]; counts: ImportCounts } {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('The uploaded workbook does not contain any worksheets.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: true,
  });

  const headerRow = rows[0] ?? [];
  const accountNumberIndex = headerRow.findIndex(isAccountHeader);

  if (accountNumberIndex === -1) {
    throw new MissingAccountNumberColumnError('Account Number column is missing.');
  }

  const accountRows: ParsedRow[] = [];
  let totalRowsSeen = 0;
  let skippedMissingAccountNumber = 0;
  let skippedInvalidAccountNumber = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    totalRowsSeen += 1;
    const cellValue = Array.isArray(row) ? row[accountNumberIndex] : undefined;
    const value = typeof cellValue === 'string' ? cellValue.trim() : cellValue;

    if (value === null || value === undefined || value === '') {
      skippedMissingAccountNumber += 1;
      continue;
    }

    const accountId = Number(value);

    if (Number.isFinite(accountId)) {
      accountRows.push({ accountId, rowNumber: i + 1 });
    } else {
      skippedInvalidAccountNumber += 1;
    }
  }

  return {
    accountRows,
    counts: {
      totalRowsSeen,
      importedCount: accountRows.length,
      skippedMissingAccountNumber,
      skippedInvalidAccountNumber,
    },
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const name = formData.get('name');

    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Campaign name is required.' }, { status: 400 });
    }

    const campaignName = name.trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A .xlsx file is required.' }, { status: 400 });
    }

    if (!file.name?.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json({ error: 'Only .xlsx uploads are supported.' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();

    let parsed;
    try {
      parsed = parseWorksheet(buffer);
    } catch (error) {
      if (error instanceof MissingAccountNumberColumnError) {
        return NextResponse.json(
          { error: 'The uploaded file is missing the Account Number column.' },
          { status: 400 }
        );
      }
      throw error;
    }

    const { accountRows, counts } = parsed;
    const statusCode = counts.importedCount === 0 ? 200 : 201;
    if (usingMockStorage()) {
      const campaign = createCampaign(campaignName);
      addImportRows(
        campaign.id,
        accountRows.map((row) => row.accountId)
      );

      return NextResponse.json(
        {
          campaign: { id: campaign.id, name: campaign.name },
          totalRowsSeen: counts.totalRowsSeen,
          importedCount: counts.importedCount,
          skippedMissingAccountNumber: counts.skippedMissingAccountNumber,
          skippedInvalidAccountNumber: counts.skippedInvalidAccountNumber,
          ...(counts.importedCount === 0
            ? { warning: 'No rows were imported because all rows were missing or invalid.' }
            : {}),
        },
        { status: statusCode }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({ name: campaignName })
      .select('id, name')
      .single();

    if (campaignError) {
      console.error('Failed to create campaign record', campaignError);
      return NextResponse.json(
        {
          error: 'Failed to create campaign record.',
          message: campaignError.message,
          code: campaignError.code,
          details: campaignError.details,
          hint: campaignError.hint,
        },
        { status: 500 }
      );
    }

    if (!campaign) {
      console.error('Failed to create campaign record: campaign missing from response');
      return NextResponse.json(
        { error: 'Failed to create campaign record.' },
        { status: 500 }
      );
    }

    if (accountRows.length > 0) {
      const { error: rowsError } = await supabase
        .from('campaign_import_rows')
        .insert(
          accountRows.map((row) => ({
            campaign_id: campaign.id,
            account_id: row.accountId,
            row_number: row.rowNumber,
          }))
        );

      if (rowsError) {
        console.error('Failed to store imported rows', rowsError);
        return NextResponse.json(
          {
            error: 'Failed to store imported rows.',
            message: rowsError.message,
            code: rowsError.code,
            details: rowsError.details,
            hint: rowsError.hint,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        campaign: { id: campaign.id, name: campaign.name },
        totalRowsSeen: counts.totalRowsSeen,
        importedCount: counts.importedCount,
        skippedMissingAccountNumber: counts.skippedMissingAccountNumber,
        skippedInvalidAccountNumber: counts.skippedInvalidAccountNumber,
        ...(counts.importedCount === 0
          ? { warning: 'No rows were imported because all rows were missing or invalid.' }
          : {}),
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error('Import failed', error);
    return NextResponse.json(
      { error: 'Unable to process the uploaded file.' },
      { status: 500 }
    );
  }
}
