#!/usr/bin/env node
// Runs some or all items of one lesson's check against a folder and prints
// one line of JSON, with the same pass rule as `npm run check`. The learn app
// runs this in a child process, so a slow item never freezes the screen.
//
//   node learn/run-check.mjs <lesson> <dir> [index ...]
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { lessons } from '../checks/lessons/index.mjs';
import { openRepo } from '../checks/repo.mjs';

const [lesson, dir, ...indexes] = process.argv.slice(2);
const fail = (error) => {
  console.log(JSON.stringify({ error }));
  process.exit(2);
};
if (!lessons[lesson]) fail(`no check for "${lesson}"`);
if (!dir || !existsSync(resolve(dir))) fail(`no such folder: ${dir}`);
const { items } = lessons[lesson];
const wanted = indexes.length ? indexes.map(Number) : items.map((_, i) => i);
if (wanted.some((i) => !Number.isInteger(i) || !items[i])) fail(`no item ${indexes.join(' ')} in ${lesson}`);

const repo = openRepo(resolve(dir));
const results = wanted.map((index) => {
  const item = items[index];
  let outcome;
  try {
    outcome = item.check(repo);
  } catch (error) {
    outcome = `The check could not run: ${error.message}`;
  }
  return { index, text: item.text, local: Boolean(item.local), pass: outcome === true, hint: outcome === true ? '' : outcome };
});
console.log(JSON.stringify({ lesson, items: results }));
