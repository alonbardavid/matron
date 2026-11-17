-- What someone an event is shared with may do with it, as a JSON list of
-- `view`, `share` and `edit`. Everyone it is shared with may view it; sharing
-- it and editing it are each given on their own.
ALTER TABLE calendar_event_share ADD COLUMN permissions TEXT NOT NULL DEFAULT '["view"]';

UPDATE calendar_event_share
SET permissions = CASE permission
  WHEN 'edit' THEN '["view","share","edit"]'
  WHEN 'share' THEN '["view","share"]'
  ELSE '["view"]'
END;

ALTER TABLE calendar_event_share DROP COLUMN permission;
