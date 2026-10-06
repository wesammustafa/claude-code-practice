# Brief: get linkcheck ready for a new teammate

**From:** the team lead

A new teammate starts on Monday. Set up this repository so their Claude Code sessions work the way ours do, and commit all of it: they get only what's in git.

## What we need

1. **A skill for a job we repeat.** We keep asking Claude to run the link checker on a folder and explain each broken link. Make that a project skill: it should run by name and load on its own when someone asks to check links.
2. **Keep Claude out of `samples/`.** The tests depend on the exact files there, including the link that's broken on purpose. Add a hook that blocks Claude's Edit and Write tools on anything inside `samples/`, and only there.
3. **A reviewer that can't change anything.** A subagent that reviews changes before we commit, with read-only tools.
4. **A browser for the docs.** Chrome DevTools MCP at project scope, pinned to one version, with its usage statistics, CrUX lookups and update checks turned off.
5. **One official plugin.** Turn on `claude-code-setup` from the official marketplace for everyone in the repository.
6. **Team settings.** Claude must never read `.env` files. It may run `npm test` without asking. The sandbox is on.
7. **Project memory.** `CLAUDE.md` pulls in `package.json` with an import, and testing conventions live in a rule scoped to the files under `test/`.

## Done when

- `npm test` passes and nothing is left uncommitted.
- `npm run check -- i-capstone` passes.
