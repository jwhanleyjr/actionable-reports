ALTER TABLE outreach_list_households
  ADD COLUMN IF NOT EXISTS completed_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS in_progress_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS not_started_count integer DEFAULT 0;

UPDATE outreach_list_households
SET completed_count = COALESCE(completed_count, 0),
    in_progress_count = COALESCE(in_progress_count, 0),
    not_started_count = COALESCE(not_started_count, 0);
