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

function parseWorksheet(buffer: ArrayBuffer): { accountIds: number[]; counts: ImportCounts } {
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

  const accountIds: number[] = [];
  let totalRowsSeen = 0;
  let skippedMissingAccountNumber = 0;
  let skippedInvalidAccountNumber = 0;

  for (const row of rows.slice(1)) {
    totalRowsSeen += 1;
    const cellValue = Array.isArray(row) ? row[accountNumberIndex] : undefined;
    const value = typeof cellValue === 'string' ? cellValue.trim() : cellValue;

    if (value === null || value === undefined || value === '') {
      skippedMissingAccountNumber += 1;
      continue;
    }

    const accountId = Number(value);

    if (Number.isFinite(accountId)) {
      accountIds.push(accountId);
    } else {
      skippedInvalidAccountNumber += 1;
    }
  }

  return {
    accountIds,
    counts: {
      totalRowsSeen,
      importedCount: accountIds.length,
      skippedMissingAccountNumber,
      skippedInvalidAccountNumber,
    },
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

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

    const { accountIds, counts } = parsed;
    const statusCode = counts.importedCount === 0 ? 200 : 201;
    if (usingMockStorage()) {
      const campaign = createCampaign(`Imported campaign ${new Date().toISOString()}`);
      addImportRows(campaign.id, accountIds);

      return NextResponse.json(
        {
          campaignId: campaign.id,
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
      .insert({ name: `Imported campaign ${new Date().toISOString()}` })
      .select('id')
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Failed to create campaign record.' },
        { status: 500 }
      );
    }

    if (accountIds.length > 0) {
      const { error: rowsError } = await supabase
        .from('campaign_import_rows')
        .insert(accountIds.map((accountId) => ({ campaign_id: campaign.id, account_id: accountId })));

      if (rowsError) {
        console.error('Failed to store imported rows', rowsError);
        return NextResponse.json(
          {
            error: 'Failed to store imported rows.',
            details: rowsError.message,
            hint: rowsError.hint,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        campaignId: campaign.id,
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
