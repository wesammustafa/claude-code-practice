---
lesson: i-capstone
title: "Intermediate capstone: get a repository ready for a new teammate"
source: docs/intermediate/capstone.md
source-commit: 52d83ec
stamp: "Verified against Claude Code v2.1.292 (stable) on 2026-10-15"
page: https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know/blob/main/docs/intermediate/capstone.md
stuck: https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know/issues/new?template=lesson-feedback.yml&lesson=i-capstone
badge: Intermediate
folder: copy
needs: [jq python3]
---

## intro
- minutes: "30 to 60 minutes"
- why: "This task puts the whole Intermediate level together."
- can: "get a repository ready for a new teammate"
- can: "run the skill by name"
- can: "delegate a review"
- can: "approve the MCP server and use one of its tools"
- can: "Pick the model and effort for each job"
- payoff: "get a repository ready for a new teammate"
- need: "`jq` and `python3` for hook scripts, and Chrome for the MCP server."

## warm-up

### R1 | Warm-up | Only Edit and Write
- tier: challenge
- skill: write-hook
- from: i-5
- where: editor
- beat: type
- ask: Which matcher makes a hook watch only Claude's Edit and Write tools?
- accept: Edit|Write
- wrong: Bash
- because: "An `Edit|Write` hook doesn't see shell commands: `echo X >> .env` goes through Bash."
- reveal: "A matcher picks the tools a hook watches: `Edit|Write` runs it for those two tools only"

### R2 | Warm-up | Still wrong after trying
- tier: challenge
- skill: set-model
- from: i-3
- where: claude
- beat: ask
- ask: Claude had the context, tried, and was still wrong. What do you change?
- wrong: A higher effort
- because: "Claude didn't try hard enough: it skipped a file or didn't run the tests"
- wrong: The context
- because: "Claude lacked context: a vague prompt, a missing tool or skill"
- right: A larger model
- reveal: "A larger model, such as `opus`"

### R3 | Warm-up | After the teammate pulls
- tier: challenge
- skill: install-plugin
- from: i-8
- where: terminal
- beat: ask
- ask: You committed a project-scope plugin entry. What does each teammate still do, once?
- right: Install the plugin on their machine
- wrong: Nothing, the commit installs it
- because: "it may not be installed on their machines yet"
- wrong: Turn it on in their own settings
- because: "Committing a project-scope entry turns the plugin on for your collaborators"
- reveal: "each of them runs `claude plugin install <plugin>@<marketplace> --scope project` once."

### R4 | Warm-up | Off, but still installed
- tier: challenge
- skill: manage-plugin
- from: i-8
- where: terminal
- beat: type
- ask: Which claude plugin command turns a plugin off, but keeps it installed?
- accept: disable
- accept: plugin disable
- accept: claude plugin disable
- wrong: uninstall
- because: "`disable` turns it off and keeps it installed; `uninstall` removes it."
- wrong: claude plugin uninstall
- because: "`disable` turns it off and keeps it installed; `uninstall` removes it."
- reveal: "claude plugin disable commit-commands@claude-plugins-official"

### R5 | Warm-up | Asked again
- tier: challenge
- skill: approve-mcp
- from: i-7
- where: shell
- beat: type
- ask: You declined a project's MCP server by mistake. Which command lets Claude Code ask you about it again?
- accept: claude mcp reset-project-choices
- accept: mcp reset-project-choices
- accept: reset-project-choices
- reveal: "To be asked about a project's servers again, run `claude mcp reset-project-choices`."

### R6 | Warm-up | Who gets the server
- tier: challenge
- skill: share-mcp
- from: i-7
- where: editor
- beat: ask
- ask: You commit an MCP server at project scope. Who gets it?
- wrong: Only you, in this project
- because: "Share the server with your team at project scope."
- right: Everyone who works in the project
- wrong: You, in every project
- because: "Share the server with your team at project scope."
- reveal: "Share the server with your team at project scope."

## steps

### T1 | The task step 1 of 7 | A link-checker skill
- tier: challenge
- skill: write-skill
- where: editor
- beat: do
- where: terminal
- skill: set-aside
- verify: check 10
- watching: git status --porcelain
- goal: "Your copy of the practice template, with no uncommitted changes"
- hint: "If `git status --porcelain` lists files, commit them or set them aside with `git stash push --include-untracked`."
- beat: do
- verify: self
- done-label: it's saved
- goal: "**A skill** that runs the link checker on a folder and explains each broken link."
- hint: "It runs by name and loads on its own when someone asks to check links ([lesson 1](01-first-skill.md))."
- hint: "The brief is in `capstone/intermediate-brief.md` in your practice copy"

### T2 | The task step 2 of 7 | Project memory and a test rule
- tier: challenge
- skill: write-rule
- where: editor
- beat: do
- skill: memory
- verify: match CLAUDE.md @package\.json
- goal: "**Project memory:** `CLAUDE.md` imports `package.json`"
- say: Done when CLAUDE.md holds the import.
- hint: "A committed `CLAUDE.md` imports a file with `@path`, and the file exists."
- beat: do
- verify: self
- done-label: it's saved
- goal: "testing conventions live in a rule in `.claude/rules/` scoped to the files under `test/`"
- hint: "A committed rule in `.claude/rules/` is scoped with `paths:`, and every scoped rule matches a file in the repository."

### T3 | The task step 3 of 7 | Team settings
- tier: challenge
- skill: edit-settings
- where: editor
- beat: do
- verify: match .claude/settings.json Read\((\./|/|\*\*/)?\.env\)
- goal: "**Team settings** in the committed `.claude/settings.json`: deny reading `.env` and `.env.*` files, allow `npm test`, and turn the sandbox on ([lesson 4](04-permissions-and-sandbox.md))."
- say: Done when a deny rule covers the .env file itself.
- hint: "The committed `.claude/settings.json` denies reading `.env` files and allows a narrow test command."
- beat: do
- verify: match .claude/settings.json Read\((\./|/|\*\*/)?\.env\.\*\)
- say: Done when a second deny rule covers the files whose names start with .env and a dot.
- hint: "deny reading `.env` and `.env.*` files"
- beat: do
- verify: match .claude/settings.json Bash\(npm test\)
- say: Done when an allow rule lets the tests run.
- hint: "allow `npm test`"
- beat: do
- skill: sandbox
- verify: json .claude/settings.json sandbox.enabled=true
- say: Done when the shared file turns the sandbox on.
- hint: "`/sandbox` saves to your local file, which teammates don't get, so add `"sandbox": {"enabled": true}` to the shared one."

### T4 | The task step 4 of 7 | A hook for samples
- tier: challenge
- skill: write-hook
- where: editor
- beat: do
- verify: json .claude/settings.json hooks.PreToolUse fresh
- goal: "**A hook** that blocks Claude's Edit and Write tools inside `samples/`, and only there: the tests depend on those exact files ([lesson 5](05-hooks.md))."
- say: Done when the shared settings file registers a hook.
- hint: "A committed, executable `PreToolUse` hook for Edit and Write blocks `samples/` and nothing else."
- beat: do
- where: terminal
- verify: self
- done-label: it's written
- say: Write the script the settings file runs, and make it executable.
- hint: "A committed, executable `PreToolUse` hook for Edit and Write blocks `samples/` and nothing else."

### T5 | The task step 5 of 7 | A reviewer subagent
- tier: challenge
- skill: write-subagent
- where: editor
- beat: do
- verify: self
- done-label: it's saved
- goal: "**A reviewer subagent** with read-only tools ([lesson 6](06-subagents.md))."
- hint: "A committed reviewer subagent has only read-only tools."

### T6 | The task step 6 of 7 | A pinned browser server
- tier: challenge
- skill: share-mcp
- where: editor
- beat: do
- verify: match .mcp.json chrome-devtools-mcp@\d+\.\d+\.\d+
- goal: "**Chrome DevTools MCP** at project scope, pinned, with its usage statistics, CrUX lookups and update checks off ([lesson 7](07-mcp.md))."
- say: Done when the server runs at an exact version.
- hint: "The committed `.mcp.json` runs chrome-devtools-mcp at an exact version, with usage statistics, CrUX lookups and update checks off."
- beat: do
- verify: match .mcp.json no-usage-statistics|usage-statistics=false
- say: Done when usage statistics are off.
- hint: "with usage statistics, CrUX lookups and update checks off"
- beat: do
- verify: match .mcp.json no-performance-crux|performance-crux=false
- say: Done when CrUX lookups are off.
- hint: "with usage statistics, CrUX lookups and update checks off"
- beat: do
- verify: match .mcp.json CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS
- say: Done when update checks are off.
- hint: "with usage statistics, CrUX lookups and update checks off"

### T7 | The task step 7 of 7 | The setup plugin
- tier: challenge
- skill: install-plugin
- where: editor
- beat: do
- verify: json .claude/settings.json enabledPlugins.claude-code-setup@claude-plugins-official=true
- goal: "**The `claude-code-setup` plugin**, turned on for everyone at project scope, and installed ([lesson 8](08-plugins.md))."
- say: Done when the shared settings file turns the plugin on.
- hint: "The committed `.claude/settings.json` turns on a plugin from one of Anthropic's marketplaces."
- beat: do
- where: terminal
- verify: self
- done-label: installed
- say: Then install it, as a teammate does.
- bottom: "claude plugin install claude-code-setup@claude-plugins-official --scope project"

### C | Check | Check
- tier: challenge
- skill: check
- where: claude
- beat: predict
- skill: approve-mcp
- safety: mcp-approval
- ask: Guess: if the session asks you to approve the project's MCP server, what do you do?
- right: Approve it, then use one of its tools
- option: Decline it, so its tools stay off
- reveal: "Then, in a session, try each part: run the skill by name, ask Claude to edit a file in `samples/` with its Edit tool, delegate a review, approve the MCP server and use one of its tools."
- beat: do
- where: terminal
- skill: start
- verify: self
- done-label: it's running
- goal: "Then, in a session, try each part"
- say: Start Claude Code in your practice copy.
- beat: self
- skill: use-mcp
- done-label: yes, I did
- note: "The check doesn't look at these parts of the Intermediate Exit. Tick them yourself, honestly"
- self: "I approved the MCP server in a session and used one of its tools."
- beat: do
- skill: match-skill
- verify: self
- done-label: I asked
- say: Ask Claude to check links, without naming the skill.
- beat: do
- skill: run-skill
- verify: self
- done-label: I ran it
- goal: "run the skill by name"
- beat: self
- skill: match-skill
- done-label: yes, I did
- self: "I ran my skill by name, and Claude loaded it on its own when I asked it to check links."
- beat: self
- skill: probe-guard
- done-label: yes, I saw it
- goal: "ask Claude to edit a file in `samples/` with its Edit tool"
- self: "I saw my hook block an Edit in `samples/` during a session."
- beat: do
- where: shell
- skill: probe-guard
- verify: git-clean samples/
- watching: git status samples
- say: Make sure nothing in samples/ changed.
- hint: "the tests depend on those exact files"
- beat: self
- skill: delegate
- done-label: yes, I did
- self: "I delegated a review to my subagent, and only its summary came back."
- beat: self
- skill: set-model
- done-label: yes, I can
- goal: "Pick the model and effort for each job as [lesson 3](03-model-and-effort.md) showed."
- self: "I can pick a model and an effort level for a task, and say why."
- beat: do
- where: shell
- skill: commit
- verify: check 10
- watching: git status --porcelain
- goal: "Commit everything, and make sure `npm test` still passes."
- hint: "commit all of it, because they get only what's in git"
- beat: do
- where: shell
- verify: check all
- run: "npm run check -- i-capstone"
- hint: "Each item that fails prints what to fix."
- beat: type
- skill: write-hook
- ask: Which hook event does your samples/ hook run on?
- accept: PreToolUse
- reveal: "A committed, executable `PreToolUse` hook for Edit and Write blocks `samples/` and nothing else."
- beat: self
- skill: install-plugin
- done-label: yes, I did
- self: "I installed the plugin with `claude plugin install claude-code-setup@claude-plugins-official --scope project`, as a teammate does after pulling the settings."
- beat: self
- skill: debug-load
- done-label: yes, I can
- self: "When Claude didn't follow an instruction, I can find out whether its file loaded."
- after: "When every box on this page is ticked, you're ready for the [Advanced level](../advanced/README.md)."

## ladder

### a committed project skill that runs the link checker by name and can load on its own
- narrow "Commit a skill in": Is the skill committed, does its body run the link checker on a folder, does its description say what it does and when to use it, and is the line that stops it loading on its own gone?
- hint: "A committed project skill runs the link checker by name and can load on its own."
- hint: "It runs by name and loads on its own when someone asks to check links ([lesson 1](01-first-skill.md))."

### a committed, executable `PreToolUse` hook for Edit and Write blocks `samples/` and nothing else
- narrow "Commit an executable script": Is the script committed and executable, and does the committed settings file run it before Edit and Write?
- narrow "A hook needs `jq`": Is jq installed on this machine?
- narrow "No Edit|Write hook exits with 2": Does your committed script exit with 2 for a path inside samples/?
- narrow "also blocks `src/cli.js`": Does your script block more than samples/, such as every path it sees?
- hint: "A committed, executable `PreToolUse` hook for Edit and Write blocks `samples/` and nothing else."
- hint: "the tests depend on those exact files"

### a committed reviewer subagent with only read-only tools
- narrow "Commit a reviewer in": Is the reviewer committed, does its name or description say it reviews, and does its tools line list only tools that read?
- hint: "A committed reviewer subagent has only read-only tools."

### the committed `.mcp.json` runs chrome-devtools-mcp at an exact version, with usage statistics, CrUX lookups and update checks off
- narrow ".mcp.json is not committed": Does git status still list the server file as new or changed?
- narrow "There is no .mcp.json": Is the server file saved at the root of your practice copy?
- narrow "is not valid JSON": Is a comma or a bracket missing, or one too many, in the server file?
- narrow "No server in .mcp.json runs": Does a server in the file name the chrome-devtools-mcp package in its arguments?
- narrow "isn't pinned": Does the package name end in an exact version, three numbers with dots?
- narrow "Usage statistics are still on": Do the arguments turn usage statistics off?
- narrow "Performance traces can still send URLs": Do the arguments turn CrUX lookups off?
- narrow "Update checks are still on": Does the server's environment turn update checks off?
- hint: "The committed `.mcp.json` runs chrome-devtools-mcp at an exact version, with usage statistics, CrUX lookups and update checks off."

### the committed `.claude/settings.json` enables a plugin from one of Anthropic's marketplaces
- narrow "There is no committed .claude/settings.json that parses": Is the shared settings file committed, and does it still parse after your last edit?
- narrow "turns on no plugin from Anthropic's marketplaces": Does the plugin's name end with the official marketplace's name, after the @?
- hint: "The committed `.claude/settings.json` turns on a plugin from one of Anthropic's marketplaces."

### the committed `.claude/settings.json` denies reading `.env` files and allows a narrow test command
- narrow "is not committed. Run": Does git status still list the shared settings file as new or changed?
- narrow "There is no .claude/settings.json": Is the file saved at that path in your practice copy?
- narrow "is not valid JSON": Is a comma or a bracket missing, or one too many, around the rules?
- narrow "Replace each TODO": Did you commit the file again after you replaced every TODO?
- narrow "Add `Read(./.env)` to": Does one deny rule name the .env file itself, with nothing after it?
- narrow "Add `Read(./.env.*)` to": Does a second deny rule cover the files whose names start with .env and a dot?
- narrow "lets every command or every use of a tool through": Does an allow rule let in a whole program or tool, rather than the one test command?
- narrow "Add an allow rule": Is there an allow rule for the command that runs the tests?
- hint: "The committed `.claude/settings.json` denies reading `.env` files and allows a narrow test command."

### the committed `.claude/settings.json` turns the sandbox on, and `.claude/settings.local.json` stays out of git
- narrow "is committed, but it holds your own settings": Did your personal settings file get committed along with the shared one?
- narrow "doesn't turn the sandbox on": Is the sandbox on in the shared file, the one teammates get, and is that change committed?
- hint: "`/sandbox` saves to your local file, which teammates don't get, so add `"sandbox": {"enabled": true}` to the shared one."

### a committed CLAUDE.md imports a file with `@path`, and the file exists
- narrow "There is no committed CLAUDE.md": Is CLAUDE.md committed at the root of your practice copy?
- narrow "has no @path import outside backticks": Is the import on a line of its own text, not inside backticks or a code block?
- narrow "An import path runs until the first space": Does a period or a comma follow the import path with no space between?
- hint: "A committed `CLAUDE.md` imports a file with `@path`, and the file exists."

### a committed rule in `.claude/rules/` is scoped with `paths:`, and every scoped rule matches a file in the repository
- narrow "No committed file in .claude/rules/ has": Is the rule committed, with its scope in the front matter at the top of the file?
- narrow "which matches no file in the repository": Does the rule's pattern match the test files as git lists them?
- hint: "A committed rule in `.claude/rules/` is scoped with `paths:`, and every scoped rule matches a file in the repository."

### the tests pass
- narrow "`npm test` fails": What is the first failure the tests print?
- narrow "has no `npm test` script": Is the check reading your practice copy?
- narrow "not an exit code": What does the saved test result file hold now?
- narrow "says the tests exited with": Do the tests pass when you run them now?
- bottom: "npm test"

### nothing is left uncommitted
- narrow "These changes are uncommitted": Which files does the check list, and do they belong in a commit?
- hint: "commit all of it, because they get only what's in git"
- bottom: "git status --porcelain"

## card
- skill: check
- show: "npm run check -- i-capstone"
- does: "Each item that fails prints what to fix."
- skill: check
- show: "git status --porcelain"
- does: "`npm test` passes, and `git status --porcelain` prints nothing."
- skill: check
- show: "git stash push --include-untracked"
- does: "If `git status --porcelain` lists files, commit them or set them aside with `git stash push --include-untracked`."
- skill: check
- show: "npm test"
- does: "make sure `npm test` still passes"
- skill: edit-settings
- show: ""sandbox": {"enabled": true}"
- does: "`/sandbox` saves to your local file, which teammates don't get, so add `"sandbox": {"enabled": true}` to the shared one."
