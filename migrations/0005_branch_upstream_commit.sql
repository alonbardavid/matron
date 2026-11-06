-- The upstream commit a branch merges in, for a branch started from "check origin updates";
-- null for a branch built from a request.
ALTER TABLE branches ADD COLUMN upstream_commit TEXT;
