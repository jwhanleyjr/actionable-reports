ALTER TABLE outreach_list_households
  ADD COLUMN IF NOT EXISTS outreach_status text DEFAULT 'not_started';

UPDATE outreach_list_households
SET outreach_status = COALESCE(outreach_status, 'not_started');
