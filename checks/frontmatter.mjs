// The YAML frontmatter of a skill or subagent file, read without a YAML
// library. It covers what those files use: `key: value` lines, quoted
// values, folded and literal blocks (`key: >-`), and lists written as
// `[a, b]` or as `- item` lines. Comments and blank lines are skipped.
// Returns null when the file doesn't start with a --- line.
const unquote = (value) => value.replace(/^(['"])(.*)\1$/, '$2');

function scalar(value) {
  const v = value.trim();
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
  return unquote(v);
}

export function frontmatter(text) {
  const lines = (text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return null;
  const fields = {};
  let key = null;
  let block = null;
  for (const line of lines.slice(1, end)) {
    if (/^\s*#/.test(line) || !line.trim()) {
      if (block && !line.trim()) block.lines.push('');
      continue;
    }
    const top = line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (top) {
      key = top[1];
      const value = (top[2] ?? '').trim();
      block = /^[|>][+-]?$/.test(value) ? { folded: value.startsWith('>'), lines: [] } : null;
      fields[key] = block ? '' : value === '' ? [] : scalar(value);
      continue;
    }
    if (!key || !/^\s/.test(line)) continue;
    if (block) {
      block.lines.push(line.trim());
      fields[key] = block.lines.join(block.folded ? ' ' : '\n').replace(/\s+$/, '');
    } else if (Array.isArray(fields[key]) && /^\s*-\s+/.test(line)) {
      fields[key].push(unquote(line.replace(/^\s*-\s+/, '').trim()));
    }
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}
