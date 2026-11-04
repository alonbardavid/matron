# The database

query_database runs one read-only SQLite SELECT and returns up to 200 rows. It answers what the list tools do not: counts, history, who has which task across the household, what a conversation was called. Column conventions: ids are text; `*_at` columns are milliseconds since the epoch (compare with `unixepoch('subsecond') * 1000`, format with `datetime(x / 1000, 'unixepoch')`); booleans are 0 or 1; `created_at` and `updated_at` exist on every table.

## user

Household members. Columns: `id`, `name`, `email` (unique), `role` (owner, admin or member), `image`, `banned` (0 or 1), `ban_reason`, `ban_expires`. The id is what other tables mean by `user_id` and `creator_id`.

## task

Columns: `id`, `title`, `description`, `creator_id` (a user), `due_date` (a calendar day as YYYY-MM-DD, or null), `completed_at` (null while open). Indexes: `creator_id`.

## task_share

Who a task is shared with, one row per user: `task_id`, `user_id`, `assigned` (1 when the task is theirs to do, 0 when they only see it). One row per task and user. Indexes: `user_id`, unique (`task_id`, `user_id`).

A member sees the tasks they created and the ones shared with them. Join `task_share` on `task_id` for "my tasks" and "who is doing what".

## calendar_event

One row per event, repeating or not. Columns: `id`, `title`, `description`, `creator_id` (a user), `all_day` (0 or 1), `start_at` and `end_at` (the first occurrence; an all-day event spans whole days), `time_zone` (an IANA zone the event was made in), `recurrence_frequency` (null for a one-off, else `weekly` or `monthly`), `recurrence_days` (a JSON array: weekdays 0 Sunday to 6 Saturday for weekly, days of the month for monthly), `recurrence_until` (the last day an occurrence may fall on, YYYY-MM-DD, or null), `recurrence_count` (how many occurrences in all, or null). Indexes: `creator_id`, `start_at`.

A repeating event is stored once: to know what happens on a given day, take the events that start before the end of that day and are either one-off within it or repeat on that weekday or day of the month, within their `until` and `count`.

## calendar_event_share

Who an event is shared with, one row per user: `event_id`, `user_id`, `attendee` (1 when they take part, 0 when they only see it). Indexes: `user_id`, unique (`event_id`, `user_id`).

A member sees the events they created and the ones shared with them.

## ask_session

Conversations with you. Columns: `id`, `user_id` (whose it is), `title` (from the first message, null until then), `archived_at` (null while open). Indexes: `user_id`.
