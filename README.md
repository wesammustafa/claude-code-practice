# Claude Code practice

The practice repository for [Claude Code: Everything You Need to Know](https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know). The lessons live in the guide; this repository holds the small app you practice on and a check for every core lesson and capstone.

Independent community guide. Not affiliated with Anthropic.

## Start

1. Select **Use this template** > **Create a new repository** to make your own copy, then clone it.
2. Or open your copy in a Codespace: Node.js, Claude Code and the sandbox's dependencies come preinstalled.

You need Node.js LTS and git. There is nothing to install with npm: the app and its checks use only Node.js itself.

## Learn step by step

Run the learning app in one terminal, and use Claude Code in a second terminal beside it:

```bash
npm run learn
```

It shows one step of a lesson at a time, watches your copy, and turns a step green as soon as your work is there. The help shrinks as you go: every command at first, then hints, then only the goal. Beginner lesson 1 is in the app so far; for the other Beginner lessons, it watches the lesson's check while you follow the page.

- Keys: arrows or numbers to choose, `enter` to go on, `h` for a hint, `m` for the map of lessons, `q` to quit. Your place is saved in `.practice/learn.json`.
- If PowerShell refuses to run `npm`, run `npm.cmd run learn`.
- Odd symbols or colors? Set `LEARN_PLAIN=1` (in PowerShell, `$env:LEARN_PLAIN=1`) before `npm run learn`. The app also follows `NO_COLOR`.
- The app has no AI in it and changes none of your work: it reads your files, runs `git status` and the lesson's check, and writes only its own file.

## Check your work

Each core lesson and each capstone ends with a check. Run it from the root of your copy:

```bash
npm run check -- b-1
```

Each item prints `PASS` or `FAIL`, with a hint for what to fix. To check a lesson you did in one of your own repositories, run the same command from your copy with `--dir` and the path to that repository, relative to your copy or in full. Here it is a folder next to your copy:

```bash
npm run check -- b-1 --dir ../my-project
```

Some items read a file you save under `.practice/`, for state that exists only for a moment, such as a plan before you approve it. Git ignores that folder, so those items are checked on your machine only.

## Track your progress

- Every push runs the **Progress** workflow, which lists each check's result in the run's summary. It never fails: an exercise you have not finished shows as "not yet", and items that read `.practice/` show as "checked locally".
- Open an issue from the **Track my progress** template for a checklist of every lesson and capstone.
- The `solutions` branch of [the template](https://github.com/wesammustafa/claude-code-practice) holds a reference solution for every check. Read it after an honest attempt.

## The app

A small Markdown link checker. It reports relative links whose file is missing:

```bash
npm run linkcheck -- samples
npm test
```

To scan only some files, or to skip some links, put a `linkcheck.json` in the folder you check: `files` lists the files and folders to scan, and `ignore` the link targets to skip, matched by how they start.

The app is `src/`, `test/` and `samples/`. The rest belongs to the course: `checks/` holds the checks, `learn/` the step-by-step learning app, `capstone/` the capstone briefs, `.claude/skills/tutor/` the optional `/tutor` coach for Beginner lesson 1, and `.github/` the workflows. The **Assert checks** workflow does its work only in the template repository: in your copy its job is skipped, which GitHub shows as a skipped check, so you can commit your exercises on any branch, `main` included.

## In a Codespace

- The Claude Code Dev Container Feature always installs the latest Claude Code release ([Dev containers](https://code.claude.com/docs/en/devcontainer)). The guide is checked against the `stable` release, which is the same or older, so the lessons still apply.
- If the browser sign-in finishes but the terminal keeps waiting, copy the code the browser shows and paste it at the `Paste code here if prompted` prompt ([Dev containers](https://code.claude.com/docs/en/devcontainer)).
- If sandboxed commands fail with `Can't mount proc on /newroot/proc: Operation not permitted`, the container is blocking the sandbox's own `/proc` mount. Setting `sandbox.enableWeakerNestedSandbox` to `true` works around it, but use it only when the container already provides the isolation you need ([Sandboxing](https://code.claude.com/docs/en/sandboxing)).
- Codespaces compute time counts against your GitHub account's included usage ([Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)).

## License

MIT. See [LICENSE](LICENSE).

Sources: [Dev containers](https://code.claude.com/docs/en/devcontainer), [Sandboxing](https://code.claude.com/docs/en/sandboxing), [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
