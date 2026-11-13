-- Whoever imported an event attends it, as an event's creator does by default.
-- Imported events nobody was given yet get their importer as the attendee.
INSERT INTO calendar_event_share (id, event_id, user_id, attendee)
SELECT
  'CS_' || lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2)
    || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2)
    || '-' || hex(randomblob(6))
  ),
  e.id,
  e.creator_id,
  1
FROM calendar_event e
WHERE e.external_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM calendar_event_share s WHERE s.event_id = e.id);
