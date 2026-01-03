-- Add outreach_lists description and reinforce household key uniqueness
ALTER TABLE outreach_lists
  ADD COLUMN IF NOT EXISTS description text;

-- Ensure solo household keys can be upserted deterministically
CREATE UNIQUE INDEX IF NOT EXISTS outreach_list_households_household_key_idx
  ON outreach_list_households (outreach_list_id, household_key);
