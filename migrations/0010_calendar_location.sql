-- Where an event happens, on the event and on a single changed occurrence.
-- An imported Google event's location used to be folded into its description;
-- the next sync moves it here.
ALTER TABLE calendar_event ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_event_exception ADD COLUMN location TEXT;
-- The place a location was picked as from Google's suggestions, as JSON:
-- Google's id, name, address, latitude, longitude and Maps link.
ALTER TABLE calendar_event ADD COLUMN place TEXT;
ALTER TABLE calendar_event_exception ADD COLUMN place TEXT;
