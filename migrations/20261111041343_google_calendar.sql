-- A member's import of their own Google Calendar: whose account it is and how
-- the last sync went. The linked account and what Google granted are the
-- auth's, in user_accounts. Never readable by the assistant.
CREATE TABLE google_calendar_connection (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  google_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);

-- Google's standing notice for one imported calendar: Google posts to the
-- application when the calendar changes, naming this row's id, and that
-- calendar is synced. Each is renewed before it expires. Never readable by
-- the assistant.
CREATE TABLE google_calendar_watch (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL UNIQUE,
  resource_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
