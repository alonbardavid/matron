-- Reverting a merged branch from troubleshooting: main goes back to the branch's base
-- commit and the production database to when the branch was created. Kept beside the
-- status, not in it, so a version from before reverts still reads every row.
ALTER TABLE branches ADD COLUMN revert_status TEXT;
ALTER TABLE branches ADD COLUMN revert_error TEXT;
ALTER TABLE branches ADD COLUMN reverted_at INTEGER;
