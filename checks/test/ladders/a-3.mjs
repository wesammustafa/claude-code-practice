// Every FAIL message of Advanced lesson 3's check, each from a work folder
// that produces it: `files` to write, or `setup(dir, { write, commit })`.
// Each scenario breaks one thing, so one narrow question matches its message.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = '.claude/workflows/migrate-paths.js';
const META = "export const meta = {\n  name: 'migrate-paths',\n  description: 'Build paths from import.meta.dirname in a folder, then fix until npm test passes',\n}\n";
const BODY = "\nconst folder = Array.isArray(args) ? args[0] : args\nconst found = await agent(`List the files under ${folder}/ that use import.meta.url.`)\nreturn found\n";
const GOOD = `${META}${BODY}`;
const OLD = {
  'src/paths.js': "import { fileURLToPath } from 'node:url';\n\nexport const root = fileURLToPath(new URL('..', import.meta.url));\n",
  'test/paths.test.js': "import { test } from 'node:test';\n\nconst fixtures = new URL('fixtures/', import.meta.url);\ntest('root', () => {});\n",
};
const NEW = {
  'src/paths.js': "import { join } from 'node:path';\n\nexport const root = join(import.meta.dirname, '..');\n",
  'test/paths.test.js': "import { test } from 'node:test';\nimport { join } from 'node:path';\n\nconst fixtures = join(import.meta.dirname, 'fixtures');\ntest('root', () => {});\n",
};
const RUN1 = 'src\n\n- src/paths.js:3\n';
const RUN2 = 'test\n\n- test/paths.test.js:4\n';
const PATTERN = 'import\\.meta\\.url\n';

// The old form committed, then migrated in the folders `migrated` names,
// with the reports and the pattern as given (null for none).
const migration = ({ migrated = ['src', 'test'], uncommitted = [], run1 = RUN1, run2 = RUN2, pattern = PATTERN } = {}) => (dir, { write, commit }) => {
  write(dir, { 'README.md': '# A project\n', ...OLD });
  commit(dir, 'Start');
  const done = Object.fromEntries(Object.entries(NEW).filter(([path]) => migrated.includes(path.split('/')[0])));
  if (Object.keys(done).length) {
    write(dir, done);
    commit(dir, 'Migrate', Object.keys(done));
  }
  write(dir, Object.fromEntries(Object.entries(NEW).filter(([path]) => uncommitted.includes(path.split('/')[0]))));
  if (run1 !== null) write(dir, { '.practice/a-3-run1.md': run1 });
  if (run2 !== null) write(dir, { '.practice/a-3-run2.md': run2 });
  if (pattern !== null) write(dir, { '.practice/a-3-pattern.txt': pattern });
};

// A workflow script committed at `path`.
const committed = (text, path = SCRIPT) => (dir, { write, commit }) => {
  write(dir, { 'README.md': '# A project\n' });
  commit(dir, 'Start');
  write(dir, { [path]: text });
  commit(dir, 'Add the workflow', [path]);
};
const noArgs = (line) => GOOD.replace('const folder = Array.isArray(args) ? args[0] : args', line);

export const scenarios = [
  { item: 0, name: 'no workflow script', files: { 'README.md': '# A project\n' } },
  {
    item: 0,
    name: 'the script saved but not committed',
    setup: (dir, { write, commit }) => {
      write(dir, { 'README.md': '# A project\n' });
      commit(dir, 'Start');
      write(dir, { [SCRIPT]: GOOD });
    },
  },
  {
    item: 0,
    name: 'the script hidden by an ignore rule',
    setup: (dir, { write, commit }) => {
      write(dir, { 'README.md': '# A project\n' });
      commit(dir, 'Start');
      appendFileSync(join(dir, '.git', 'info', 'exclude'), '.claude/\n');
      write(dir, { [SCRIPT]: GOOD });
    },
  },
  { item: 0, name: 'the script in a subfolder', setup: committed(GOOD, '.claude/workflows/team/migrate-paths.js') },
  { item: 0, name: 'code before meta', setup: committed(`const folder = args\n${GOOD}`) },
  { item: 0, name: 'a variable in meta', setup: committed(GOOD.replace("name: 'migrate-paths'", 'name: NAME')) },
  { item: 0, name: 'meta without a description', setup: committed(GOOD.replace(/\n {2}description: .*\n/, '\n')) },
  { item: 0, name: 'a script that does not compile', setup: committed(`${GOOD}const late = await agent(\nlet x = 1\n`) },
  { item: 0, name: 'a script that never reads args', setup: committed(noArgs("const folder = 'src'")) },
  { item: 0, name: 'args only in a comment', setup: committed(noArgs("// TODO: read the folder from args\nconst folder = 'src'")) },
  { item: 0, name: 'a script that declares its own args', setup: committed(noArgs("const args = 'src'\nconst folder = args")) },
  { item: 1, name: 'no reports', files: { 'README.md': '# A project\n' } },
  { item: 1, name: 'the second report missing', setup: migration({ run2: null }) },
  { item: 1, name: 'an empty first report', setup: migration({ run1: '' }) },
  { item: 1, name: 'a first line that names the root', setup: migration({ run1: '.\n\n- src/paths.js:3\n' }) },
  { item: 1, name: 'a first line that names no folder', setup: migration({ run1: '# Migration report\n\n- src/paths.js:3\n' }) },
  { item: 1, name: 'both reports on one folder', setup: migration({ run2: 'src\n\n- src/paths.js:1\n' }) },
  { item: 1, name: 'a citation outside the folder', setup: migration({ run1: 'src\n\n- src/paths.js:3\n- test/paths.test.js:4\n' }) },
  { item: 1, name: 'paths written from inside the folder', setup: migration({ run1: 'src\n\n- paths.js:3\n' }) },
  { item: 1, name: 'a citation of a file the folder lacks', setup: migration({ run1: 'src\n\n- src/missing.js:3\n' }) },
  { item: 1, name: 'a report with no citation', setup: migration({ run1: 'src\n\nMigrated the paths.\n' }) },
  { item: 2, name: 'no pattern file', setup: migration({ pattern: null }) },
  { item: 2, name: 'an empty pattern file', setup: migration({ pattern: '\n' }) },
  { item: 2, name: 'no reports to name the folders', setup: migration({ run1: null, run2: null }) },
  { item: 2, name: 'a pattern git cannot read', setup: migration({ pattern: 'import\\.meta\\.(url\n' }) },
  { item: 2, name: 'a migration left uncommitted', setup: migration({ migrated: ['test'], uncommitted: ['src'] }) },
  { item: 2, name: 'a folder never migrated', setup: migration({ migrated: ['test'] }) },
  { item: 2, name: 'a pattern that matched in one folder only', setup: migration({ pattern: 'fileURLToPath\n' }) },
];
