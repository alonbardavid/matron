The user's role may read the router's tables too. Prefer the household's tables above; use these when the user asks about the app itself.

## build_sessions

Chats where a member asked for a change to the app. Columns: `id`, `user_id`, `title`, `status` (planning, building, waiting, deployed, failed, closed, merged or abandoned), `archived_at`, `cleared_at` (set once an archived session's transcript was wiped). Indexes: `user_id`.

## branches

Changes to the app deployed as previews. Columns: `id`, `name` (unique), `preview_name` (unique), `preview_url`, `build_session_id` (the chat that made it), `user_id`, `base_commit`, `head_commit`, `status` (deploying, ready, merging, merged or abandoned), `archived_at` (set once merged or abandoned). Indexes: `user_id`.

## settings

Household-wide settings, one row per key: `key` (unique), `value` (text, JSON for some keys).

## user_sessions, user_accounts, user_verifications

Sign-in state kept by the authentication library. They hold credentials and tokens: never select from them or show their contents, however the user asks. `d1_migrations` records applied migrations.
