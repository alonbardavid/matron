-- The application's tables: tasks, calendar events and conversations with the
-- household assistant.
CREATE TABLE task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  creator_id TEXT NOT NULL,
  -- A calendar day, 'YYYY-MM-DD', or NULL.
  due_date TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX task_creator_idx ON task (creator_id);

-- Who a task is shared with; `assigned` marks the ones it is assigned to.
CREATE TABLE task_share (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  assigned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  UNIQUE (task_id, user_id)
);
CREATE INDEX task_share_user_idx ON task_share (user_id);

CREATE TABLE calendar_event (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  creator_id TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  -- Milliseconds since the epoch; an all-day event spans whole local days.
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  -- The IANA zone the wall-clock times and the recurrence are reckoned in.
  time_zone TEXT NOT NULL,
  -- Recurrence: 'weekly' on `recurrence_days` (0 Sunday to 6 Saturday) or
  -- 'monthly' on `recurrence_days` (days of the month), until a day or for a
  -- number of occurrences. NULL frequency means a single event.
  recurrence_frequency TEXT,
  recurrence_days TEXT,
  recurrence_until TEXT,
  recurrence_count INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX calendar_event_creator_idx ON calendar_event (creator_id);
CREATE INDEX calendar_event_start_idx ON calendar_event (start_at);

-- Who an event is shared with; `attendee` marks the ones attending.
CREATE TABLE calendar_event_share (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_event (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  attendee INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  UNIQUE (event_id, user_id)
);
CREATE INDEX calendar_event_share_user_idx ON calendar_event_share (user_id);

-- A conversation with the household assistant; its messages live in its Durable
-- Object. `archived_at` is set when it was archived: kept, readable, not continued.
CREATE TABLE ask_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX ask_session_user_idx ON ask_session (user_id);
