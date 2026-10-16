// What `npm run learn` prints when it isn't attached to a terminal (piped,
// in CI, or with no TTY): every lesson in the course and its check, as
// plain text with no escape codes. Slow items are left out: it says how
// many npm run check also runs.
import { C } from './copy.mjs';
import { lessonLabel, titleOf } from './render.mjs';

export function plainProgress(course, results, saved) {
  const lines = [C.plainIntro, ''];
  for (const l of course) {
    const r = results[l.id];
    const done = saved?.lessons?.[l.id]?.complete ? ' (done in the app)' : '';
    const ran = r?.items?.filter((i) => !i.slow) ?? [];
    const slow = (r?.items?.length ?? 0) - ran.length;
    const checked = l.newCopy ? C.newCopyPlain : r?.error ? `the check could not run: ${r.error}`
      : `${ran.filter((i) => i.pass).length} of ${ran.length} check items pass${slow ? ` (npm run check -- ${l.id} also runs ${slow} slower one${slow === 1 ? '' : 's'})` : ''}`;
    lines.push(`${lessonLabel(l.id).padEnd(4)} ${titleOf(l)}: ${checked}${done}`);
    lines.push(`     ${l.url}`);
  }
  return `${lines.join('\n')}\n`;
}
