ALTER TABLE outreach_list_households
  ADD COLUMN IF NOT EXISTS outreach_status text;

UPDATE outreach_list_households
SET outreach_status = COALESCE(outreach_status, 'not_started');

ALTER TABLE outreach_list_households
  ALTER COLUMN outreach_status SET DEFAULT 'not_started',
  ALTER COLUMN outreach_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_list_households_status_check'
  ) THEN
    ALTER TABLE outreach_list_households
      ADD CONSTRAINT outreach_list_households_status_check
      CHECK (outreach_status IN ('not_started', 'in_progress', 'complete'));
  END IF;
END $$;
