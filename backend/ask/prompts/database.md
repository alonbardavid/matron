# The database

query_database runs one read-only SQLite SELECT and returns up to 200 rows. It answers what the list tools do not: counts, history, who has which task across the household, what a conversation was called. Column conventions: ids are text; `*_at` columns are milliseconds since the epoch (compare with `unixepoch('subsecond') * 1000`, format with `datetime(x / 1000, 'unixepoch')`); booleans are 0 or 1; `created_at` and `updated_at` exist on every table.

## user

Household members. Columns: `id`, `name`, `email` (unique), `role` (owner, admin or member), `image`, `banned` (0 or 1), `ban_reason`, `ban_expires`. The id is what other tables mean by `user_id` and `creator_id`.

## task

Columns: `id`, `title`, `description`, `creator_id` (a user), `due_date` (a calendar day as YYYY-MM-DD, or null), `completed_at` (null while open). Indexes: `creator_id`.

## task_share

Who a task is shared with, one row per user: `task_id`, `user_id`, `assigned` (1 when the task is theirs to do, 0 when they only see it). One row per task and user. Indexes: `user_id`, unique (`task_id`, `user_id`).

A member sees the tasks they created and the ones shared with them. Join `task_share` on `task_id` for "my tasks" and "who is doing what".

## calendar

A member's calendars; every event belongs to one. Columns: `id`, `owner_id` (a user), `name`, `color` (`#rrggbb`), `source` (`matron` for one made here, `google` for one imported from the owner's Google Calendar), `external_id` (an imported calendar's id at the source, else null), `is_default` (1 on the owner's calendar for new events; one per owner), `receives_shared` (1 on the calendar where events others share with the owner show; at most one per owner, else the default). Indexes: `owner_id`, unique (`owner_id`, `source`, `external_id`).

## calendar_share

A calendar shared read-only with another member, one row per viewer: `calendar_id`, `user_id`, `color` (the viewer's own colour for it, or null for the calendar's). Indexes: `user_id`, unique (`calendar_id`, `user_id`).

## calendar_event

One row per event, repeating or not. Columns: `id`, `title`, `description`, `creator_id` (a user), `calendar_id` (the calendar it belongs to, one of the creator's), `all_day` (0 or 1), `start_at` and `end_at` (the first occurrence; an all-day event spans whole days), `time_zone` (an IANA zone the times and the repetition are reckoned in), `rrule` (null for a one-off, else an iCalendar RRULE value such as `FREQ=WEEKLY;BYDAY=TU,TH`, with the event's start as the series' first occurrence), `external_id`, `external_series_id` and `external_url` (an imported event's id, its series' id and its link at the source, else null). Indexes: `creator_id`, `start_at`, `calendar_id`, unique (`calendar_id`, `external_id`).

A repeating event is stored once, and SQL cannot expand an RRULE: to know what happens on a given day, use list_events, which does. Query this table for counts, searches by title and one-off events.

## calendar_event_exception

One occurrence of a repeating event cancelled or changed: `event_id`, `original_start_at` (when the series had it due), `cancelled` (1 when it does not happen), `title`, `description`, `start_at`, `end_at` (what the occurrence changed; null keeps the series' own), `external_id`. Unique (`event_id`, `original_start_at`).

## calendar_event_share

Who an event is shared with, one row per user: `event_id`, `user_id`, `attendee` (1 when they take part, 0 when they only see it), `calendar_id` (the recipient's own calendar it shows in, or null for their calendar for shared events). Indexes: `user_id`, unique (`event_id`, `user_id`).

A member sees the events they created, the ones shared with them, and every event in a calendar shared with them.

## ask_session

Conversations with you. Columns: `id`, `user_id` (whose it is), `title` (from the first message, null until then), `archived_at` (null while open). Indexes: `user_id`.
