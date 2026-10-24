---
name: team-review
description: The team's review of a change, for bugs, missing tests and unclear code. Use it on a staged diff locally or on a pull request in CI.
---

Review one change and change no file.

1. Find the change. If a diff came with the prompt, review that diff. Otherwise run `git diff origin/<base branch>...HEAD`, where the base branch is `$GITHUB_BASE_REF` in CI.
2. Read each file the diff changes, around each change, so you judge the code and not only the lines.
3. List each problem as `file:line` and one sentence: a bug, a missing test, or code a teammate would misread.
4. End with one line: ready to commit, or not yet and why.
