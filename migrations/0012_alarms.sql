-- A member's own alarm on an event or a task: how long before it starts or is
-- due they are reminded. Its Durable Object rings it at that moment.
CREATE TABLE alarm (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  minutes_before INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE UNIQUE INDEX alarm_subject_user ON alarm (kind, subject_id, user_id);

-- An alarm rings once on its own, so nothing records what went out.
DROP TABLE reminder;
