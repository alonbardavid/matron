-- What a branch is for: 'session-request' is a change a member asked for in a build
-- session, 'upstream-pull' merges the upstream repository's commits in.
ALTER TABLE branches ADD COLUMN type TEXT NOT NULL DEFAULT 'session-request';
