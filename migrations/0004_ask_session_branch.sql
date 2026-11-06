-- The branch a conversation was started on. A Preview's database begins as a copy of
-- production, so conversations from main appear there too; they are continued only on main.
ALTER TABLE ask_session ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
