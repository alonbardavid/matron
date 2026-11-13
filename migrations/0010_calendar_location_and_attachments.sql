-- Where an event happens, on the event and on a single changed occurrence.
-- An imported Google event's location used to be folded into its description;
-- the next sync moves it here.
ALTER TABLE calendar_event ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_event_exception ADD COLUMN location TEXT;
-- The place a location was picked as from Google's suggestions, as JSON:
-- Google's id, name, address, latitude, longitude and Maps link.
ALTER TABLE calendar_event ADD COLUMN place TEXT;
ALTER TABLE calendar_event_exception ADD COLUMN place TEXT;

-- Files uploaded to an event, and links; ones imported from Google are links
-- with the source 'google', replaced on each sync.
CREATE TABLE calendar_event_attachment (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_event (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_id TEXT,
  url TEXT,
  title TEXT NOT NULL,
  mime_type TEXT,
  source TEXT NOT NULL DEFAULT 'matron',
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX calendar_event_attachment_event_idx ON calendar_event_attachment (event_id);
