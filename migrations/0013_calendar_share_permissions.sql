-- What each member an event is shared with may do: view, edit, or manage it
-- (share it, set who attends, remove it). Until now every recipient could
-- edit an event's details on the server, so existing shares keep edit.
ALTER TABLE calendar_event_share ADD COLUMN permission TEXT NOT NULL DEFAULT 'edit';
