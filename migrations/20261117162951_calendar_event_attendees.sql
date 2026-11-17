-- Who attends an event, one row per member. Attending is its own fact: it does
-- not show the event to the member, and sharing it with them does not make
-- them attend.
CREATE TABLE calendar_event_attendee (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE UNIQUE INDEX calendar_event_attendee_event_user
  ON calendar_event_attendee (event_id, user_id);

INSERT INTO calendar_event_attendee (id, event_id, user_id, created_at)
SELECT 'CA_' || substr(id, 4), event_id, user_id, created_at
FROM calendar_event_share
WHERE attendee = 1;

-- A share is only for someone other than whoever made the event.
DELETE FROM calendar_event_share
WHERE user_id = (
  SELECT creator_id FROM calendar_event WHERE calendar_event.id = calendar_event_share.event_id
);

ALTER TABLE calendar_event_share DROP COLUMN attendee;
