You are bringing branch `{{branch}}` up to date with the upstream Matron repository: the
project this deployment was released from. The household's own changes live on main; the
upstream has moved on since. Nothing new is being built here: the goal is main's features
and upstream's together, working.

## The request

{{request}}

## What upstream changed

{{plan}}

## The merge

{{sync}}

## How to finish it

- If the merge is still in progress, resolve every conflicted file keeping both sides:
  the household's changes and upstream's. `git diff` shows the conflicts and
  `git log --oneline HEAD..MERGE_HEAD` what upstream brought. Remove every conflict marker.
- Files the runner owns (`scripts/`, `apps/builder/`, `turbo.json`,
  `apps/backend/wrangler.jsonc`) are never changed by a household: take upstream's version
  with `git checkout --theirs -- <path>`.
- Then `git add` the resolved files and finish the merge with `git commit --no-edit`.
- Check `migrations/`: if upstream added a migration whose number main already uses for a
  different file, rename upstream's new file to the next free number. Never rename a
  migration main already had: production has applied it under that name.
- Read `CLAUDE.md` again: upstream may have changed the rules. Then run `pnpm type-check`
  and the Playwright tests of the areas both sides touched, and fix what the combination
  broke, preferring upstream's patterns.
- Further notes from the user, if any: {{extra}}

Finish with `status: done` and a short `message` for the household: what the update brings
and anything that changed for them. Use `blocked` only when the two cannot be reconciled.
