// The Intermediate checks, run the way a Learner runs them: against their own
// repository with --dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { check, commit, repo, withRepo, write } from './helpers.mjs';

// The tdd skill as lesson i-1's Your turn leaves it once finished.
const FINISHED_TDD = `---
name: tdd
description: Builds a feature test-first, one behavior at a time. Use when the user asks for a new function or feature with tests, or says test-first or TDD.
---

Build this test-first, one behavior at a time: $ARGUMENTS

1. Red: write one failing test for the next behavior and run it.
2. Green: write the least code that makes the tests pass, and run them.
3. Refactor: tidy the code with the tests still passing.
`;

// A repository with the tdd skill committed, then a commit a /tdd run made,
// saved for the check as lesson i-1 asks.
function skillRepo({ skill = FINISHED_TDD, commitSkill = true, change = { 'src/slug.js': 'export {}\n', 'test/slug.test.js': '// test\n' } } = {}) {
  return () => {
    const dir = repo({ '.claude/skills/tdd/SKILL.md': skill });
    commit(dir, 'Add the tdd skill', commitSkill ? ['.claude/skills/tdd/SKILL.md'] : []);
    write(dir, change);
    const sha = commit(dir, 'Add slugify', Object.keys(change));
    write(dir, { '.practice/i-1-commit.txt': `${sha}\n` });
    return dir;
  };
}

test('i-1 passes with the finished skill committed and a commit that changes a test and its code', () => {
  withRepo(skillRepo(), (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-1 fails while the skill is not committed, and says how to commit it', () => {
  withRepo(skillRepo({ commitSkill: false }), (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /git add \.claude\/skills\/tdd\/SKILL\.md/);
  });
});

test('i-1 fails when there is no tdd skill at all', () => {
  withRepo(() => repo(), (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /There is no \.claude\/skills\/tdd\/SKILL\.md/);
  });
});

test('i-1 fails on the unfinished skill: TODOs, no description and run-by-name only', () => {
  const partial = '---\nname: tdd\ndescription: TODO\ndisable-model-invocation: true\n---\n\n1. Red: write a failing test.\n2. Green: TODO\n3. Refactor: TODO\n';
  withRepo(skillRepo({ skill: partial }), (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /TODO on lines 3, 8, 9/);
    assert.match(out, /disable-model-invocation: true/);
  });
});

test('i-1 asks for a description that says what the skill does and when to use it', () => {
  const short = FINISHED_TDD.replace(/^description: .*$/m, 'description: Test-first.');
  withRepo(skillRepo({ skill: short }), (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /when Claude should use it/);
  });
});

test('i-1 reads a description written as a folded block over several lines', () => {
  const folded = FINISHED_TDD.replace(/^description: .*$/m, 'description: >-\n  Builds a feature test-first, one behavior at a time.\n  Use when the user asks for a feature with tests.');
  withRepo(skillRepo({ skill: folded }), (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-1 fails when the frontmatter name means /tdd would not run the skill', () => {
  withRepo(skillRepo({ skill: FINISHED_TDD.replace('name: tdd', 'name: test-first') }), (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /\/test-first/);
  });
});

test('i-1 fails when the saved commit changes only tests, or only code', () => {
  for (const change of [{ 'test/slug.test.js': '// test\n' }, { 'src/slug.js': 'export {}\n' }]) {
    withRepo(skillRepo({ change }), (dir) => {
      const { code, out } = check(['i-1', '--dir', dir]);
      assert.equal(code, 1, out);
      assert.match(out, /test and the code it tests/);
    });
  }
});

test('i-1 says how to save the commit when none is saved', () => {
  withRepo(() => {
    const dir = repo({ '.claude/skills/tdd/SKILL.md': FINISHED_TDD });
    commit(dir, 'Add the tdd skill');
    return dir;
  }, (dir) => {
    const { code, out } = check(['i-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /git rev-parse HEAD > \.practice\/i-1-commit\.txt/);
  });
});

// A repository after lesson i-2: CLAUDE.md imports package.json, a rule is
// scoped to the test files, and the load log a session wrote.
const LOG = (dir, lines) => lines.map(([reason, path]) => `${reason}\t${dir}/${path}`).join('\n') + '\n';
function memoryRepo({
  claudeMd = '# linkcheck\n\n- npm scripts: @package.json\n',
  rules = { 'testing.md': '---\npaths:\n  - "test/**/*.js"\n---\n\n- Use node:test.\n' },
  log = [['session_start', 'CLAUDE.md'], ['include', 'package.json'], ['path_glob_match', '.claude/rules/testing.md']],
} = {}) {
  return () => {
    const files = { 'CLAUDE.md': claudeMd, 'package.json': '{}\n', 'test/links.test.js': '// test\n', 'src/cli.js': '// cli\n' };
    for (const [name, text] of Object.entries(rules)) files[`.claude/rules/${name}`] = text;
    const dir = repo(files);
    commit(dir, 'Organize project memory');
    if (log) write(dir, { '.practice/i-2-loaded.txt': LOG(dir, log) });
    return dir;
  };
}

test('i-2 passes with an import, a scoped rule that matches files, and a log of both loading', () => {
  withRepo(memoryRepo(), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-2 fails without an @path import in the committed CLAUDE.md, and ignores one in backticks', () => {
  withRepo(memoryRepo({ claudeMd: '# linkcheck\n\n- The scripts are in `@package.json`.\n' }), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /no @path import/);
  });
});

test('i-2 says a period after the imported path becomes part of it', () => {
  withRepo(memoryRepo({ claudeMd: '# linkcheck\n\nThe npm scripts are in @package.json.\n' }), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /package\.json\. doesn't exist/);
    assert.match(out, /first space/);
  });
});

test('i-2 fails for a scoped rule whose paths match no file, and names it', () => {
  const rules = { 'testing.md': '---\npaths: "test/**/*.js"\n---\n', 'cli.md': '---\npaths:\n  - "source/**/*.js"\n---\n' };
  withRepo(memoryRepo({ rules }), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /\.claude\/rules\/cli\.md/);
    assert.match(out, /source\/\*\*\/\*\.js/);
  });
});

test('i-2 needs at least one rule scoped with paths', () => {
  withRepo(memoryRepo({ rules: { 'style.md': '- Two spaces.\n' } }), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /paths:/);
  });
});

test('i-2 matches brace patterns and a comma-separated paths value', () => {
  const rules = { 'code.md': '---\npaths:\n  - "src/**/*.{js,ts}"\n---\n', 'lib.md': '---\npaths: lib/*.js, src/*.js\n---\n' };
  const log = [['include', 'package.json'], ['path_glob_match', '.claude/rules/code.md']];
  withRepo(memoryRepo({ rules, log }), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-2 says how to start a logged session when there is no log', () => {
  withRepo(memoryRepo({ log: null }), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /--settings \.practice\/i-2-hook\.json/);
  });
});

test('i-2 fails when the log shows no scoped rule loading, and says which tools load one', () => {
  withRepo(memoryRepo({ log: [['session_start', 'CLAUDE.md'], ['include', 'package.json']] }), (dir) => {
    const { code, out } = check(['i-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /Read tool/);
  });
});

// A repository after lesson i-3: the changelog skill with its model and
// effort filled in, and the entry a /changelog run committed.
const CHANGELOG_SKILL = (model, effort) => `---
name: changelog
description: Adds a one-line entry for the staged changes to CHANGELOG.md. Use when the user asks for a changelog entry.
model: ${model}
effort: ${effort}
disable-model-invocation: true
---

Read the staged changes and add one line under ## Unreleased in CHANGELOG.md.
`;
function effortRepo({ model = 'sonnet', effort = 'low', changelog = '## Unreleased\n\n- Report broken links in headings.\n' } = {}) {
  return () => {
    const files = { '.claude/skills/changelog/SKILL.md': CHANGELOG_SKILL(model, effort) };
    if (changelog !== null) files['CHANGELOG.md'] = changelog;
    const dir = repo(files);
    commit(dir, 'Add a changelog skill and an entry');
    return dir;
  };
}

test('i-3 passes for a small model at low effort and a committed entry', () => {
  withRepo(effortRepo(), (dir) => {
    const { code, out } = check(['i-3', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-3 accepts haiku, a full Sonnet model name, and medium effort', () => {
  for (const [model, effort] of [['haiku', 'low'], ['claude-sonnet-5-5', 'medium']]) {
    withRepo(effortRepo({ model, effort }), (dir) => {
      const { code, out } = check(['i-3', '--dir', dir]);
      assert.equal(code, 0, out);
    });
  }
});

test('i-3 fails while model and effort are still TODO', () => {
  withRepo(effortRepo({ model: 'TODO', effort: 'TODO' }), (dir) => {
    const { code, out } = check(['i-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /model/);
  });
});

test('i-3 says a routine task does not need a larger model or a higher effort', () => {
  for (const [model, effort, hint] of [['opus', 'low', /larger model/], ['sonnet', 'high', /higher effort/]]) {
    withRepo(effortRepo({ model, effort }), (dir) => {
      const { code, out } = check(['i-3', '--dir', dir]);
      assert.equal(code, 1, out);
      assert.match(out, hint);
    });
  }
});

test('i-3 fails without a committed changelog entry under Unreleased', () => {
  for (const changelog of [null, '## Unreleased\n\n']) {
    withRepo(effortRepo({ changelog }), (dir) => {
      const { code, out } = check(['i-3', '--dir', dir]);
      assert.equal(code, 1, out);
      assert.match(out, /\/changelog/);
    });
  }
});

// A repository after lesson i-4: team rules in the committed shared settings,
// and the sandbox turned on in the personal file that stays out of git.
const TEAM = { permissions: { allow: ['Bash(npm test)'], deny: ['Read(./.env)', 'Read(./.env.*)'] } };
const LOCAL = { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } };
function scopesRepo({ team = TEAM, local = LOCAL, commitLocal = false } = {}) {
  return () => {
    const files = {};
    if (team) files['.claude/settings.json'] = typeof team === 'string' ? team : JSON.stringify(team, null, 2);
    if (local) files['.claude/settings.local.json'] = JSON.stringify(local, null, 2);
    const dir = repo(files);
    commit(dir, 'Add team settings', [...(team ? ['.claude/settings.json'] : []), ...(commitLocal ? ['.claude/settings.local.json'] : [])]);
    return dir;
  };
}

test('i-4 passes with team rules committed and the sandbox on in the uncommitted local file', () => {
  withRepo(scopesRepo(), (dir) => {
    const { code, out } = check(['i-4', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-4 accepts the sandbox turned on in the shared file, with no local file', () => {
  withRepo(scopesRepo({ team: { ...TEAM, sandbox: { enabled: true } }, local: null }), (dir) => {
    const { code, out } = check(['i-4', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-4 fails while the partial file still has its TODOs', () => {
  const partial = { permissions: { allow: ['TODO: the command that runs your tests'], deny: ['TODO: reading .env'] } };
  withRepo(scopesRepo({ team: partial }), (dir) => {
    const { code, out } = check(['i-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /TODO/);
  });
});

test('i-4 needs deny rules for .env and the other .env files', () => {
  withRepo(scopesRepo({ team: { permissions: { allow: ['Bash(npm test)'], deny: ['Read(./.env)'] } } }), (dir) => {
    const { code, out } = check(['i-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /\.env\.\*/);
  });
});

test('i-4 refuses an allow rule that lets every command or every edit through', () => {
  for (const rule of ['Bash', 'Bash(*)', 'Bash(npm *)', 'Bash(npm:*)', 'Edit']) {
    withRepo(scopesRepo({ team: { permissions: { allow: ['Bash(npm test)', rule], deny: TEAM.permissions.deny } } }), (dir) => {
      const { code, out } = check(['i-4', '--dir', dir]);
      assert.equal(code, 1, `${rule}: ${out}`);
      assert.ok(out.includes(rule), out);
    });
  }
});

test('i-4 fails when the shared settings are not valid JSON', () => {
  withRepo(scopesRepo({ team: '{ "permissions": { "allow": ["Bash(npm test)"], } }' }), (dir) => {
    const { code, out } = check(['i-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /not valid JSON/);
  });
});

test('i-4 fails when the personal file is committed, and when the sandbox is off', () => {
  withRepo(scopesRepo({ commitLocal: true }), (dir) => {
    const { code, out } = check(['i-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /git rm --cached \.claude\/settings\.local\.json/);
  });
  withRepo(scopesRepo({ local: { sandbox: { enabled: false } } }), (dir) => {
    const { code, out } = check(['i-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /\/sandbox/);
  });
});

// A repository after lesson i-5: the finished protect-files hook, executable
// and registered as a PreToolUse hook for Edit and Write.
const FIXED_HOOK = `#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
FILE_PATH="\${FILE_PATH//\\\\//}"
NAME=$(basename "$FILE_PATH")
case "$NAME" in
  .env.example) ;;
  .env | .env.*) echo "Blocked: $FILE_PATH is an env file" >&2; exit 2 ;;
esac
case "/$FILE_PATH" in
  */secrets/*) echo "Blocked: $FILE_PATH is in a secrets folder" >&2; exit 2 ;;
esac
exit 0
`;
// The hooks guide's script: a substring match that blocks too much and misses secrets/.
const GUIDE_HOOK = `#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
for pattern in ".env" "package-lock.json" ".git/"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then echo "Blocked: $FILE_PATH" >&2; exit 2; fi
done
exit 0
`;
const REGISTERED = { hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-files.sh', args: [] }] }] } };
function hookRepo({ hook = FIXED_HOOK, mode = 0o755, settings = REGISTERED } = {}) {
  return () => {
    const dir = repo({ '.claude/hooks/protect-files.sh': hook, '.claude/settings.json': JSON.stringify(settings, null, 2) });
    chmodSync(join(dir, '.claude/hooks/protect-files.sh'), mode);
    commit(dir, 'Protect env files and secrets');
    return dir;
  };
}

test('i-5 passes for the finished hook, committed, executable and registered', () => {
  withRepo(hookRepo(), (dir) => {
    const { code, out } = check(['i-5', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

test('i-5 fails for the guide script, naming each path it gets wrong', () => {
  withRepo(hookRepo({ hook: GUIDE_HOOK }), (dir) => {
    const { code, out } = check(['i-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /\.env\.example/);
    assert.match(out, /secrets\/api\.key/);
    assert.match(out, /config\.envelope\.ts/);
  });
});

test('i-5 fails when the script is not executable', () => {
  withRepo(hookRepo({ mode: 0o644 }), (dir) => {
    const { code, out } = check(['i-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /chmod \+x/);
  });
});

test('i-5 fails when the hook is not registered for Edit and Write before tools run', () => {
  for (const settings of [{}, { hooks: { PostToolUse: REGISTERED.hooks.PreToolUse } }, { hooks: { PreToolUse: [{ ...REGISTERED.hooks.PreToolUse[0], matcher: 'Bash' }] } }]) {
    withRepo(hookRepo({ settings }), (dir) => {
      const { code, out } = check(['i-5', '--dir', dir]);
      assert.equal(code, 1, out);
      assert.match(out, /PreToolUse/);
    });
  }
});
