-- Ensure outreach list households support unique household keys for solo households
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_list_households_list_key_unique'
  ) THEN
    ALTER TABLE public.outreach_list_households
      ADD CONSTRAINT outreach_list_households_list_key_unique
      UNIQUE (outreach_list_id, household_key);
  END IF;
END $$;
