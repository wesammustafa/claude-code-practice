// What a file holds, for the beats that read it (ticket 87): `file`, `json`,
// `match` and `no-match`, and the evidence line a check shows. Main reads
// the file's bytes as they are now, in the lesson's work folder; these
// decide what they mean. Pure: nothing here reads the disk or starts a
// process.
import { C } from './copy.mjs';

// A file's text: UTF-16 with a byte-order mark (Windows PowerShell 5.1
// writes it), or UTF-8 with or without one.
export function textOf(buf) {
  return buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8').replace(/^﻿/, '');
}

// What a binary file is, in place of its bytes: a PNG's width and height,
// or any other's size. Null for text, which holds no NUL byte (UTF-16 with a
// byte-order mark is text).
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
function binaryOf(buf) {
  if ((buf[0] === 0xff && buf[1] === 0xfe) || !buf.subarray(0, 8000).includes(0)) return null;
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG) && buf.toString('latin1', 12, 16) === 'IHDR') return C.pngImage(buf.readUInt32BE(16), buf.readUInt32BE(20));
  return C.binaryData(buf.length < 1024 ? `${buf.length} bytes` : `${Math.round(buf.length / 1024)} KB`);
}

// The lines of a file that say something, trimmed: not a leading front
// matter block, and no line that is only ---, { or [, which open one.
function saying(text) {
  const lines = text.split(/\r?\n/);
  const end = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  return lines.slice(end + 1).map((l) => l.trim()).filter((l) => l && !['---', '{', '['].includes(l));
}

// The line a done beat shows of its file, to show what the learner made.
export function evidenceOf(buf) {
  if (!buf) return null;
  return binaryOf(buf) ?? saying(textOf(buf))[0]?.slice(0, 60) ?? null;
}

// The value at a dotted key path, or `undefined` where any part is missing.
function at(value, key) {
  let v = value;
  for (const part of key.split('.')) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined;
    v = v[part];
  }
  return v;
}
const shown = (v) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 60);

// Whether `buf` (null: no file) passes a reading beat's verify, with the
// evidence a pass shows or the not-yet line a miss gets.
export function judge(verify, buf) {
  const { path } = verify;
  if (!buf) return { pass: false, hint: verify.kind === 'file' ? C.fileEmpty(path) : C.noFile(path) };
  const text = textOf(buf);
  if (verify.kind === 'file') {
    const binary = binaryOf(buf);
    if (binary) return { pass: true, evidence: binary };
    // A list shows its first line and how many more, so a short list shows.
    const lines = saying(text);
    if (!lines.length) return { pass: false, hint: C.fileEmpty(path) };
    const first = lines[0].slice(0, 60);
    return { pass: true, evidence: lines.length > 1 ? C.andMore(first, lines.length - 1) : first };
  }
  if (verify.kind === 'match' || verify.kind === 'no-match') {
    const re = new RegExp(verify.regex);
    const hit = text.split(/\r?\n/).find((l) => re.test(l));
    const line = hit === undefined ? null : hit.trim().slice(0, 60);
    if (verify.kind === 'match') return line === null ? { pass: false, hint: C.noLine(path) } : { pass: true, evidence: line };
    return line === null ? { pass: true, evidence: null } : { pass: false, hint: C.stillHas(path, line) };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { pass: false, hint: C.notJson(path, error.message) };
  }
  if (!verify.key) return { pass: true, evidence: evidenceOf(buf) };
  const found = at(value, verify.key);
  if (found === undefined) return { pass: false, hint: C.noKey(path, verify.key) };
  // A value given as text equals a string with that text, or any other
  // value written that way in JSON: `=success`, `=false`, `=3`.
  if (verify.value !== null && verify.value !== (typeof found === 'string' ? found : JSON.stringify(found))) {
    return { pass: false, hint: C.notValue(path, verify.key, shown(found), verify.value) };
  }
  return { pass: true, evidence: shown(found) };
}
