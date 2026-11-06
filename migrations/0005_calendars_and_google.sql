-- Household-wide secrets, encrypted: the Google OAuth client secret, for one.
-- Never readable by the assistant.
CREATE TABLE secret_settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);

-- A member's calendars: every event belongs to one. Each member has a default
-- Matron calendar; each Google calendar they import is a calendar of its own.
CREATE TABLE calendar (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'matron',
  external_id TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX calendar_owner_idx ON calendar (owner_id);
CREATE UNIQUE INDEX calendar_owner_source_external ON calendar (owner_id, source, external_id);
CREATE UNIQUE INDEX calendar_owner_default ON calendar (owner_id) WHERE is_default = 1;

-- Every event belongs to a calendar; an imported one also keeps its id at the
-- source, so a sync updates it in place. The column is nullable only because
-- SQLite cannot add a NOT NULL column without a default; the code always sets it.
ALTER TABLE calendar_event ADD COLUMN calendar_id TEXT REFERENCES calendar (id) ON DELETE CASCADE;
ALTER TABLE calendar_event ADD COLUMN external_id TEXT;
CREATE INDEX calendar_event_calendar_idx ON calendar_event (calendar_id);
CREATE UNIQUE INDEX calendar_event_calendar_external ON calendar_event (calendar_id, external_id);

-- Existing events move to a default Matron calendar for each creator.
INSERT INTO calendar (id, owner_id, name, color, source, is_default)
SELECT 'CL_' || lower(hex(randomblob(16))), creator_id, 'Matron', '#b9086e', 'matron', 1
FROM (SELECT DISTINCT creator_id FROM calendar_event);
UPDATE calendar_event
SET calendar_id = (
  SELECT id FROM calendar
  WHERE calendar.owner_id = calendar_event.creator_id AND calendar.is_default = 1
);

-- A member's link to their own Google Calendar; tokens are encrypted.
CREATE TABLE google_calendar_connection (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  google_email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
