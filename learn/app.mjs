#!/usr/bin/env node
// npm run learn: one step at a time, beside Claude Code. No AI inside, and it
// changes none of your work.
import { main } from './lib/main.mjs';

main().then((code) => {
  if (code !== undefined) process.exitCode = code;
});
