-- Labels the household tags events with: a name and a colour, shared by every
-- member. An event shows its labels as coloured bars along its side.
CREATE TABLE calendar_label (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);

CREATE TABLE calendar_event_label (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_event (id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES calendar_label (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE UNIQUE INDEX calendar_event_label_event_label ON calendar_event_label (event_id, label_id);
CREATE INDEX calendar_event_label_label_idx ON calendar_event_label (label_id);
