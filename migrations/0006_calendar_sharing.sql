-- Calendars shared read-only with other members, each viewer with their own colour.
CREATE TABLE calendar_share (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendar (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE UNIQUE INDEX calendar_share_calendar_user ON calendar_share (calendar_id, user_id);
CREATE INDEX calendar_share_user_idx ON calendar_share (user_id);

-- Where events others share with a member show: the calendar they pick for one
-- event, else their calendar for shared events, else their default.
ALTER TABLE calendar ADD COLUMN receives_shared INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX calendar_owner_receives_shared ON calendar (owner_id) WHERE receives_shared = 1;
ALTER TABLE calendar_event_share ADD COLUMN calendar_id TEXT;

-- An imported occurrence of a repeating Google event keeps its series' id, and
-- every imported event its link at Google.
ALTER TABLE calendar_event ADD COLUMN external_series_id TEXT;
ALTER TABLE calendar_event ADD COLUMN external_url TEXT;
