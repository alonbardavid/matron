**Upstream update**: merge the upstream repository's commit `{{commit}}` into this deployment.

## How it is merged

Nothing new is built here: the goal is this household's own changes and upstream's together, working.

- The commit is already in the clone. Merge it with `git merge {{commit}}`. Where files conflict, keep both sides: the household's changes and upstream's. `git log --oneline HEAD..MERGE_HEAD` shows what upstream brought. Remove every conflict marker.
- Files the runner owns (`scripts/`, `apps/builder/`, `turbo.json`, `apps/backend/wrangler.jsonc`) are never changed by a household: take upstream's version with `git checkout --theirs -- <path>`.
- `git add` the resolved files and finish the merge with `git commit --no-edit`. Never run `git fetch`, `git pull` or `git push`: the runner pushes and deploys afterwards.
- If upstream added a migration whose number main already uses for a different file, rename upstream's new file to the next free number. Never rename a migration main already had: production has applied it under that name.
- Read `CLAUDE.md` again, since upstream may have changed the rules. Then run the type check and the tests of the areas both sides touched, and fix what the combination broke, preferring upstream's patterns.
- If the merge changed `apps/builder/`, say so in your message: that part applies after the next `pnpm run deploy` from a terminal.

In your message, say what the update brings and anything that changes for the household.

The result is deployed as a Preview to try. Merge it from the branch menu once it works.
