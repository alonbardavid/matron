-- Each guest's answer to an event: needs_action, accepted, tentative or declined.
-- Whoever made an event has accepted it; everyone else has yet to answer.
ALTER TABLE calendar_event_share ADD COLUMN response TEXT NOT NULL DEFAULT 'needs_action';
UPDATE calendar_event_share
SET response = 'accepted'
WHERE user_id = (SELECT creator_id FROM calendar_event WHERE calendar_event.id = calendar_event_share.event_id);

-- An imported event's guests at its source and their answers, as JSON.
ALTER TABLE calendar_event ADD COLUMN external_guests TEXT;
