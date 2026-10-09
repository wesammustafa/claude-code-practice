# Brief: review every pull request, within limits

**From:** the team lead

We want Claude to review our pull requests in CI, the same way on everyone's machine, and nothing it runs may go unbounded. Build it in this repository and commit all of it: the team gets only what's in git.

## What we need

1. **Two jobs at once.** Build parts 2 and 3 in two Claude Code sessions that run at the same time, each in its own worktree, and merge both branches into `main`. Keep the worktrees out of git. After both sessions commit, and while both worktrees exist, save `git worktree list --porcelain` to `.practice/a-capstone-worktrees.txt`.
2. **A review script.** `scripts/review-staged.sh` sends the staged changes to `claude -p` and saves the JSON result: read-only tools, anything else refused without a permission prompt, and a turn limit of 10 or fewer. Run it once on a staged one-line change and save its result to `.practice/a-capstone-run.json`.
3. **Our plugin, for everyone.** A marketplace inside the repository, `team-marketplace/`, with one plugin of ours. The committed `.claude/settings.json` registers it by a relative path and turns the plugin on, so nobody installs anything by hand.
4. **A review we can rerun.** A dynamic workflow that reviews each file under `src/` and has a second agent check each finding, saved to `.claude/workflows/` and committed.
5. **CI review with limits.** `.github/workflows/claude-review.yml` reviews each pull request with `anthropics/claude-code-action`: pinned to a release tag or a full commit SHA, its credential from a secret, a read-only token, a turn limit of 10 or fewer, allowed tools without unrestricted Bash, and a job timeout of 30 minutes or fewer. Claude reviews; a person merges.

## Done when

- `npm test` passes and nothing is left uncommitted.
- `npm run check -- a-capstone` passes.
- Then tear down, as the guide's capstone page says, so no live credential is left behind.
