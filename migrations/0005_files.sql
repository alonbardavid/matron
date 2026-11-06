-- Uploaded files: the bytes live in the R2 bucket under storage_key, the row says
-- what they are, who uploaded them and who may see them: 'household' (everyone) or
-- 'private' (the uploader; an owner sees every file). A member's picture is a
-- household file whose id the better-auth `user.image` column holds.
CREATE TABLE file (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX file_user_idx ON file (user_id);
