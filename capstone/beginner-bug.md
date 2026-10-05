# Bug: a missing folder in linkcheck.json is silently skipped

**Reported by:** a teammate

## What happens

With this `linkcheck.json`:

```json
{ "files": ["docs"] }
```

in a folder that has no `docs/` folder, `npm run linkcheck -- .` prints `All relative links resolve.` and exits with code 0.

## What should happen

The tool should stop with an error that names the missing folder, `docs`, and exit with code 2, the same code it uses for a broken `linkcheck.json`.

## Notes

- The folders are read in `src/check-links.js`; the exit codes are set in `src/cli.js`.
- Add a test that fails before the fix and passes after it.
