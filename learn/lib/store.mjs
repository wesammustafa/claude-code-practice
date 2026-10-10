// The learner's place, saved in `.practice/learn.json` of the practice copy:
// git ignores `.practice/`, and every check that reads git status leaves it
// out. It is the only file the app writes, and only once `.practice/` exists.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FORMAT = 1;
export const storePath = (root) => join(root, '.practice', 'learn.json');

export function loadState(root) {
  try {
    const data = JSON.parse(readFileSync(storePath(root), 'utf8'));
    if (data?.format !== FORMAT) return null;
    return sanitize(data);
  } catch {
    return null;
  }
}

// Keeps only what the app saves, so a hand-edited or newer file can't
// smuggle anything in.
export function sanitize(data) {
  const lessons = {};
  for (const [id, p] of Object.entries(data?.lessons ?? {})) {
    if (!/^[a-z]-(\d+|capstone)$/.test(id) || typeof p !== 'object' || !p) continue;
    lessons[id] = {
      step: typeof p.step === 'string' ? p.step : null,
      beat: Number.isInteger(p.beat) && p.beat >= 0 ? p.beat : 0,
      done: Array.isArray(p.done) ? p.done.filter((x) => typeof x === 'string') : [],
      answers: Object.fromEntries(Object.entries(p.answers ?? {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 200)])),
      levels: Array.isArray(p.levels) ? p.levels.filter((x) => ['hinted', 'challenge'].includes(x)) : [],
      lessHelp: p.lessHelp === true,
      keepGuided: p.keepGuided === true,
      easedSteps: Object.fromEntries(Object.entries(p.easedSteps ?? {}).filter(([, v]) => v === true)),
      complete: p.complete === true,
    };
  }
  return {
    format: FORMAT,
    welcomed: data?.welcomed === true,
    eased: Array.isArray(data?.eased) ? data.eased.filter((x) => typeof x === 'string') : [],
    lessons,
  };
}

export const snapshot = (state) => sanitize({ welcomed: state.welcomed, eased: state.eased, lessons: state.progress });

// Writes atomically. Returns false, writing nothing, while `.practice/` is missing.
export function saveState(root, data) {
  if (!existsSync(join(root, '.practice'))) return false;
  const file = storePath(root);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
  try {
    renameSync(tmp, file);
  } catch (error) {
    // Windows: another program (an editor, antivirus) may hold the file a moment.
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
    try {
      renameSync(tmp, file);
    } catch (again) {
      rmSync(tmp, { force: true });
      throw again;
    }
  }
  return true;
}
