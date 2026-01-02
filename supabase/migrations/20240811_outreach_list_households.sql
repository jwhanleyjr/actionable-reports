-- Update outreach list household uniqueness and member foreign keys

-- Household key + solo constituent support
ALTER TABLE outreach_list_households
  ADD COLUMN IF NOT EXISTS household_key text,
  ADD COLUMN IF NOT EXISTS solo_constituent_id bigint;

-- Populate household_key for existing rows
UPDATE outreach_list_households
SET household_key = COALESCE(
  household_key,
  CASE
    WHEN household_id IS NOT NULL THEN 'h:' || household_id
    ELSE 'c:' || COALESCE(solo_constituent_id, household_id, 0)::text
  END
)
WHERE household_key IS NULL;

ALTER TABLE outreach_list_households
  ALTER COLUMN household_key SET NOT NULL;

-- Check constraint: exactly one of household_id or solo_constituent_id should be set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_list_households_household_choice_check'
  ) THEN
    ALTER TABLE outreach_list_households
      ADD CONSTRAINT outreach_list_households_household_choice_check
      CHECK (
        (household_id IS NOT NULL AND solo_constituent_id IS NULL)
        OR (household_id IS NULL AND solo_constituent_id IS NOT NULL)
      );
  END IF;
END $$;

-- Unique constraints and indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_list_households_unique'
  ) THEN
    ALTER TABLE outreach_list_households
      ADD CONSTRAINT outreach_list_households_unique UNIQUE (outreach_list_id, household_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_list_households_household_key_idx
  ON outreach_list_households (outreach_list_id, household_key);

-- Members: add outreach_list_household_id FK and relax household_id nullability
ALTER TABLE outreach_list_members
  ADD COLUMN IF NOT EXISTS outreach_list_household_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_list_members_household_id_fkey'
  ) THEN
    ALTER TABLE outreach_list_members DROP CONSTRAINT outreach_list_members_household_id_fkey;
  END IF;
END $$;

ALTER TABLE outreach_list_members
  ALTER COLUMN household_id DROP NOT NULL;

-- Backfill outreach_list_household_id
UPDATE outreach_list_members m
SET outreach_list_household_id = h.id,
    household_id = COALESCE(m.household_id, h.household_id)
FROM outreach_list_households h
WHERE m.outreach_list_id = h.outreach_list_id
  AND m.outreach_list_household_id IS NULL
  AND (
    (m.household_id IS NOT NULL AND h.household_id = m.household_id)
    OR (m.household_id IS NULL AND h.solo_constituent_id = m.constituent_id)
  );

ALTER TABLE outreach_list_members
  ALTER COLUMN outreach_list_household_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_list_members_outreach_list_household_id_fkey'
  ) THEN
    ALTER TABLE outreach_list_members
      ADD CONSTRAINT outreach_list_members_outreach_list_household_id_fkey
      FOREIGN KEY (outreach_list_household_id)
      REFERENCES outreach_list_households (id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_list_members_unique
  ON outreach_list_members (outreach_list_id, constituent_id);
