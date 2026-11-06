-- Repeating events follow the iCalendar standard (RFC 5545): an RRULE value
-- beside the event's start (its DTSTART, in time_zone), and exceptions for
-- single occurrences cancelled or changed.
ALTER TABLE calendar_event ADD COLUMN rrule TEXT;

-- The old weekly and monthly series, as RRULEs. A last day becomes a day-valued
-- UNTIL, read as that day's end in the event's zone.
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
