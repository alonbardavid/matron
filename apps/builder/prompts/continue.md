The user replied in the build chat:

{{message}}

{{attachments}}

Before this turn the runner fetched main, so the local `origin/main` ref is current: {{sync}}

If main has commits the branch lacks, merge them before anything else: run
`git merge origin/main`. If files have conflicts, resolve them keeping both the branch's
intent and main's changes, remove every conflict marker, `git add` the resolved files and
finish with `git commit --no-edit`. `git diff HEAD...origin/main` shows what main changed.

Then continue the work. If the reply answers a question you asked, proceed with the change.
If it is a new request on the same branch, implement it the same way: read the relevant
code, keep the change self-contained, type-check, run the tests that might be affected, and finish
with `status: done`. If the
reply only asks to bring the branch up to date, the merge is the whole change.

Never run `git fetch`, `git pull` or `git push`: the workspace has no credentials for the
remote. The runner fetches before each turn and commits, pushes and deploys after it.
