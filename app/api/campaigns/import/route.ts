import { NextResponse } from 'next/server';
import XLSX from 'xlsx';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

type ParsedRow = Record<string, unknown>;

type ImportCounts = {
  totalRows: number;
  validRows: number;
  skippedRows: number;
};

function extractAccountId(row: ParsedRow): number | null {
  const matchingKey = Object.keys(row).find(
    (key) => key.toLowerCase() === 'account_id'
  );

  if (!matchingKey) {
    return null;
  }

  const rawValue = row[matchingKey];
  const accountId = Number(rawValue);

  return Number.isFinite(accountId) ? accountId : null;
}

function parseWorksheet(buffer: ArrayBuffer): { accountIds: number[]; counts: ImportCounts } {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('The uploaded workbook does not contain any worksheets.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<ParsedRow>(worksheet, { defval: null });

  const accountIds: number[] = [];

  for (const row of rows) {
    const accountId = extractAccountId(row);

    if (accountId !== null) {
      accountIds.push(accountId);
    }
  }

  const totalRows = rows.length;
  const validRows = accountIds.length;

  return {
    accountIds,
    counts: {
      totalRows,
      validRows,
      skippedRows: Math.max(totalRows - validRows, 0),
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
    const { accountIds, counts } = parseWorksheet(buffer);

    const { data: campaign, error: campaignError } = await supabaseAdmin
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
      const { error: rowsError } = await supabaseAdmin
        .from('campaign_import_rows')
        .insert(accountIds.map((accountId) => ({ campaign_id: campaign.id, account_id: accountId })));

      if (rowsError) {
        return NextResponse.json(
          { error: 'Failed to store imported rows.' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        campaignId: campaign.id,
        totalRows: counts.totalRows,
        validRows: counts.validRows,
        skippedRows: counts.skippedRows,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Import failed', error);
    return NextResponse.json(
      { error: 'Unable to process the uploaded file.' },
      { status: 500 }
    );
  }
}
