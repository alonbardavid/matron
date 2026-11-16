-- Where an event happens, on the event and on a single changed occurrence.
-- An imported Google event's location used to be folded into its description;
-- the next sync moves it here.
ALTER TABLE calendar_event ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_event_exception ADD COLUMN location TEXT;
-- What Google gave for the location when it was picked from Google's
-- suggestions, as JSON: the place id, name, address, latitude, longitude and
-- Maps link. Null for a location typed.
ALTER TABLE calendar_event ADD COLUMN location_metadata TEXT;
ALTER TABLE calendar_event_exception ADD COLUMN location_metadata TEXT;
