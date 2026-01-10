ALTER TABLE outreach_lists
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS outreach_lists_archived_at_idx
  ON outreach_lists (archived_at);
