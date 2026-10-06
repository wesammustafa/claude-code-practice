---
name: changelog
description: Adds a one-line entry for the staged changes to CHANGELOG.md. Use when the user asks for a changelog entry.
model: sonnet
effort: low
disable-model-invocation: true
---

Read the staged changes with `git diff --staged`. Add one line under `## Unreleased` in CHANGELOG.md that says what changed for someone using the tool, creating the file and the heading if they don't exist. Change no other file.
