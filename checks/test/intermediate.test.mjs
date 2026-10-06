// The Intermediate checks, run the way a Learner runs them: against their own
// repository with --dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
