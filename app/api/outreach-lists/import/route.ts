import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { parseAccountNumbersFromWorkbook } from '../../../../lib/xlsxImport';

const VALID_GOALS = ['Thank', 'Ask', 'Report'];
const VALID_STAGES = ['Draft', 'Active', 'Paused'];

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const name = (formData.get('name') as string | null)?.trim() || 'New Outreach List';
  const goal = (formData.get('goal') as string | null)?.trim();
  const stage = (formData.get('stage') as string | null)?.trim();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'A .xlsx file is required.' }, { status: 400 });
  }

  if (!VALID_GOALS.includes(goal || '')) {
    return NextResponse.json({ ok: false, error: 'Goal must be Thank, Ask, or Report.' }, { status: 400 });
  }

  if (!VALID_STAGES.includes(stage || '')) {
    return NextResponse.json({ ok: false, error: 'Stage must be Draft, Active, or Paused.' }, { status: 400 });
  }

  let parsedRows: ReturnType<typeof parseAccountNumbersFromWorkbook>;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsedRows = parseAccountNumbersFromWorkbook(buffer);
  } catch (error) {
    console.error('Failed to parse outreach list workbook.', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? `Unable to read the Excel file: ${error.message}`
            : 'Unable to read the Excel file.',
      },
      { status: 400 }
    );
  }

  if (!parsedRows.length) {
    return NextResponse.json({ ok: false, error: 'No account numbers were found in the uploaded file.' }, { status: 400 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Supabase configuration is missing.' },
      { status: 500 }
    );
  }

  const { data: listData, error: listError } = await supabase
    .from('outreach_lists')
    .insert({ name, goal, stage })
    .select('id')
    .single();

  if (listError || !listData?.id) {
    console.error('Failed to create outreach list.', listError);
    const isNetworkError = listError?.message?.includes('fetch failed') || listError?.details?.includes('ENOTFOUND');
    return NextResponse.json(
      {
        ok: false,
        error: isNetworkError
          ? 'Unable to reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL and network/DNS configuration.'
          : listError?.message || 'Unable to create outreach list.',
      },
      { status: 500 }
    );
  }

  const importRows = parsedRows.map((row, index) => ({
    outreach_list_id: listData.id,
    row_number: index + 1,
    account_number: row.accountNumber,
    source_row: row.sourceRow,
  }));

  const { error: importError } = await supabase
    .from('outreach_list_import_rows')
    .insert(importRows);

  if (importError) {
    console.error('Failed to create outreach list import rows.', importError);
    const isNetworkError = importError?.message?.includes('fetch failed') || importError?.details?.includes('ENOTFOUND');
    return NextResponse.json(
      {
        ok: false,
        error: isNetworkError
          ? 'Unable to reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL and network/DNS configuration.'
          : importError.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    outreachListId: listData.id,
    importedCount: importRows.length,
  });
}
