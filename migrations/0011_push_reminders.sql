-- A device that receives push notifications: the Web Push subscription its
-- browser handed out, and the time zone it was in when it subscribed.
CREATE TABLE push_subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX push_subscription_user_idx ON push_subscription (user_id);

-- One row per reminder sent: a person and what they were reminded of. Claiming
-- the row before sending is what keeps the hourly sweep from repeating itself.
CREATE TABLE reminder (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE UNIQUE INDEX reminder_subject_user ON reminder (subject, user_id);
