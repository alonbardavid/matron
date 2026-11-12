-- A member's calendars: every event belongs to one. Each member has a default
-- calendar, which new events go to, and may name one for the events others
-- share with them. A calendar imported from elsewhere keeps its id at the source.
CREATE TABLE calendar (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'matron',
  external_id TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  receives_shared INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX calendar_owner_idx ON calendar (owner_id);
CREATE UNIQUE INDEX calendar_owner_source_external ON calendar (owner_id, source, external_id);
CREATE UNIQUE INDEX calendar_owner_default ON calendar (owner_id) WHERE is_default = 1;
CREATE UNIQUE INDEX calendar_owner_receives_shared ON calendar (owner_id) WHERE receives_shared = 1;

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

-- Every event belongs to a calendar. The column is nullable only because SQLite
-- cannot add a NOT NULL column without a default; the code always sets it. An
-- imported event also keeps its id at the source, so a sync updates it in
-- place, the id of its series there when it is one occurrence of a repeating
-- event, and its link at the source.
ALTER TABLE calendar_event ADD COLUMN calendar_id TEXT REFERENCES calendar (id) ON DELETE CASCADE;
ALTER TABLE calendar_event ADD COLUMN external_id TEXT;
ALTER TABLE calendar_event ADD COLUMN external_series_id TEXT;
ALTER TABLE calendar_event ADD COLUMN external_url TEXT;
CREATE INDEX calendar_event_calendar_idx ON calendar_event (calendar_id);
CREATE UNIQUE INDEX calendar_event_calendar_external ON calendar_event (calendar_id, external_id);

-- Existing events go to a default calendar for each creator.
INSERT INTO calendar (id, owner_id, name, color, source, is_default)
SELECT 'CL_' || lower(hex(randomblob(16))), creator_id, 'Matron', '#b9086e', 'matron', 1
FROM (SELECT DISTINCT creator_id FROM calendar_event);
UPDATE calendar_event
SET calendar_id = (
  SELECT id FROM calendar
  WHERE calendar.owner_id = calendar_event.creator_id AND calendar.is_default = 1
);

-- Where an event shared with a member shows: the calendar they pick for it,
-- else their calendar for shared events, else their default.
ALTER TABLE calendar_event_share ADD COLUMN calendar_id TEXT;

-- Repeating events follow the iCalendar standard (RFC 5545): an RRULE value
-- beside the event's start (its DTSTART, in time_zone), and exceptions for
-- single occurrences cancelled or changed.
ALTER TABLE calendar_event ADD COLUMN rrule TEXT;

-- Existing weekly and monthly series, as RRULEs. A last day becomes a
-- day-valued UNTIL, read as that day's end in the event's zone.
UPDATE calendar_event
SET rrule = 'FREQ=WEEKLY;BYDAY=' || (
    SELECT group_concat(
      CASE value WHEN 0 THEN 'SU' WHEN 1 THEN 'MO' WHEN 2 THEN 'TU' WHEN 3 THEN 'WE'
        WHEN 4 THEN 'TH' WHEN 5 THEN 'FR' ELSE 'SA' END, ',')
    FROM json_each(calendar_event.recurrence_days)
  )
  || CASE WHEN recurrence_until IS NOT NULL THEN ';UNTIL=' || replace(recurrence_until, '-', '') ELSE '' END
  || CASE WHEN recurrence_count IS NOT NULL THEN ';COUNT=' || recurrence_count ELSE '' END
WHERE recurrence_frequency = 'weekly';

UPDATE calendar_event
SET rrule = 'FREQ=MONTHLY;BYMONTHDAY=' || (
    SELECT group_concat(value, ',') FROM json_each(calendar_event.recurrence_days)
  )
  || CASE WHEN recurrence_until IS NOT NULL THEN ';UNTIL=' || replace(recurrence_until, '-', '') ELSE '' END
  || CASE WHEN recurrence_count IS NOT NULL THEN ';COUNT=' || recurrence_count ELSE '' END
WHERE recurrence_frequency = 'monthly';

ALTER TABLE calendar_event DROP COLUMN recurrence_frequency;
ALTER TABLE calendar_event DROP COLUMN recurrence_days;
ALTER TABLE calendar_event DROP COLUMN recurrence_until;
ALTER TABLE calendar_event DROP COLUMN recurrence_count;

CREATE TABLE calendar_event_exception (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_event (id) ON DELETE CASCADE,
  original_start_at INTEGER NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  description TEXT,
  start_at INTEGER,
  end_at INTEGER,
  external_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE UNIQUE INDEX calendar_event_exception_event_original
  ON calendar_event_exception (event_id, original_start_at);
