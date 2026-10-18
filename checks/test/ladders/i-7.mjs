// Every FAIL message of Intermediate lesson 7's check, each from a work
// folder that produces it: `files` to write, or `setup(dir, { write, commit })`.
// Each scenario breaks one thing, so one narrow question matches its message.
const MCP = '.mcp.json';
const SHOT = '.practice/i-7-page.png';
const ARGS = ['-y', 'chrome-devtools-mcp@1.10.1', '--isolated', '--no-usage-statistics', '--no-performance-crux'];
const ENV = { CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' };
const config = (args = ARGS, env = ENV) => `${JSON.stringify({ mcpServers: { 'chrome-devtools': { type: 'stdio', command: 'npx', args, env } } }, null, 2)}\n`;
const without = (flag) => ARGS.filter((a) => a !== flag);

// Commits `.mcp.json` with `text`, so only item 0 can fail.
const shared = (text) => (dir, { write, commit }) => {
  write(dir, { [MCP]: text });
  commit(dir, 'Share Chrome DevTools MCP', [MCP]);
};

export const scenarios = [
  { item: 0, name: 'no .mcp.json', files: {} },
  { item: 0, name: 'the file saved but not committed', files: { [MCP]: config() } },
  { item: 0, name: 'a trailing comma in the committed file', setup: shared(config().replace('"--no-performance-crux"', '"--no-performance-crux",')) },
  { item: 0, name: 'the partial file committed with its TODOs', setup: shared(config(['-y', 'TODO: the package at an exact version', '--isolated', 'TODO: no usage statistics', 'TODO: no CrUX lookups'], { 'TODO: the variable that turns off update checks': '1' })) },
  { item: 0, name: 'the package at @latest', setup: shared(config(ARGS.map((a) => (a.startsWith('chrome-devtools-mcp') ? 'chrome-devtools-mcp@latest' : a)))) },
  {
    item: 0,
    name: 'the file fixed but the fix not committed',
    setup(dir, { write, commit }) {
      shared(config(ARGS.map((a) => (a.startsWith('chrome-devtools-mcp') ? 'chrome-devtools-mcp@latest' : a))))(dir, { write, commit });
      write(dir, { [MCP]: config() });
    },
  },
  { item: 0, name: 'usage statistics left on', setup: shared(config(without('--no-usage-statistics'))) },
  { item: 0, name: 'CrUX lookups left on', setup: shared(config(without('--no-performance-crux'))) },
  { item: 0, name: 'update checks left on', setup: shared(config(ARGS, {})) },
  { item: 1, name: 'no screenshot', files: {} },
  { item: 1, name: 'a JPEG saved under the PNG name', files: { [SHOT]: '\xff\xd8\xff\xe0 not a PNG' } },
];

