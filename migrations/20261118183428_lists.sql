-- Lists of items. A list is shared as a whole: everyone it is shared with sees
-- every item in it, and does what their share allows. Items nest under one
-- another and keep the order they were put in.
CREATE TABLE list (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- A colour from the app's palette, '#rrggbb'.
  color TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX list_creator_idx ON list (creator_id);

-- Who a list is shared with, and what each may do with it, as a JSON list of
-- `view`, `share` and `edit`; viewing it is always among them.
CREATE TABLE list_share (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES list (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '["view"]',
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  UNIQUE (list_id, user_id)
);
CREATE INDEX list_share_user_idx ON list_share (user_id);

-- An item on a list: at the top, or under another item of the same list
-- (`parent_id`), at `position` among the items beside it.
CREATE TABLE list_item (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES list (id) ON DELETE CASCADE,
  parent_id TEXT,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  creator_id TEXT NOT NULL,
  -- A calendar day, 'YYYY-MM-DD', or NULL.
  due_date TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX list_item_list_idx ON list_item (list_id, parent_id, position);
CREATE INDEX list_item_due_idx ON list_item (due_date);

-- Who an item is assigned to: people who see its list.
CREATE TABLE list_item_assignee (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES list_item (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  UNIQUE (item_id, user_id)
);
CREATE INDEX list_item_assignee_user_idx ON list_item_assignee (user_id);
