---
name: review-checklist
description: Walks a change through the team's review checklist for linkcheck (tests, the source-file header line, samples/, error messages, secrets) and reports each item as met or not, with the file and line. Use before committing a change or opening a pull request, or when someone asks whether a change is ready.
---

Review the current change against the team's checklist. Read files only; don't change any.

1. Find the change: the staged diff (`git diff --cached`) if anything is staged, otherwise the unstaged diff. If both are empty, say there is nothing to review and stop.
2. Check each item, reading the files the change touches and the tests that cover them:
   - Every changed function in `src/` has a test in `test/`, one test file per source file, named after the behavior it checks.
   - Every new source file starts with the line `// Part of linkcheck.`
   - Nothing in `samples/` changed: its broken link is there on purpose, and the tests rely on it.
   - Each new or changed error message says what is wrong and what to write instead.
   - No key, token or password appears in the change.
3. Report one line per item: met, not met or not applicable, with the file and line for each one not met and a concrete fix. End with whether the change is ready to commit.
