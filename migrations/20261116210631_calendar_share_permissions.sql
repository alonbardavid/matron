-- What each member an event is shared with may do: view it, share it too
-- (who it is shared with, who attends), or edit it too. Until now every
-- recipient could edit an event's details on the server, so existing shares
-- keep edit.
ALTER TABLE calendar_event_share ADD COLUMN permission TEXT NOT NULL DEFAULT 'edit';
