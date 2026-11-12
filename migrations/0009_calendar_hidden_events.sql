-- Events a member hid from their own calendar: every occurrence, for them alone.
CREATE TABLE calendar_event_hidden (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_event (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE UNIQUE INDEX calendar_event_hidden_event_user ON calendar_event_hidden (event_id, user_id);
CREATE INDEX calendar_event_hidden_user_idx ON calendar_event_hidden (user_id);
