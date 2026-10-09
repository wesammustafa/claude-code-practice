// One `claude` command line, read the way Claude Code v2.1.285 reads it
// (with the commander library): `--flag value` and `--flag=value`; short
// flags that combine, as in `-cp`; a flag whose value is optional takes the
// next argument only when it isn't an option; a flag that takes a list keeps
// taking arguments until the next option, so a prompt written after
// `--allowedTools Read` becomes a tool name. Shared by the Advanced checks
// that run a script with a stand-in for `claude`.

// The options `claude --help` lists at v2.1.285, and the documented ones it
// leaves out, written as --help writes them: `<value>`, `[optional value]`
// or `<list...>`.
const SPEC = [
  '--add-dir <directories...>',
  '--advisor <model>',
  '--agent <agent>',
  '--agents <json-or-file>',
  '--allow-dangerously-skip-permissions',
  '--allowedTools, --allowed-tools <tools...>',
  '--append-subagent-system-prompt <prompt>',
  '--append-subagent-system-prompt-file <file>',
  '--append-system-prompt <prompt>',
  '--append-system-prompt-file <file>',
  '--autocompact <auto|tokens>',
  '--ax-screen-reader',
  '--bg, --background',
  '--bare',
  '--betas <betas...>',
  '--brief',
  '--channels <servers...>',
  '--chrome',
  '--client-data-url <url>',
  '--cloud [description|session_id|url]',
  '-c, --continue',
  '--dangerously-load-development-channels <servers...>',
  '--dangerously-skip-permissions',
  '-d, --debug [filter]',
  '--debug-file <path>',
  '--desktop',
  '--disable-slash-commands',
  '--disallowedTools, --disallowed-tools <tools...>',
  '--effort <level>',
  '--environment <environment_id>',
  '--exclude-dynamic-system-prompt-sections',
  '--fallback-model <model>',
  '--file <specs...>',
  '--fork-session',
  '--forward-subagent-text',
  '--from-pr [value]',
  '-h, --help',
  '--ide',
  '--include-hook-events',
  '--include-partial-messages',
  '--init',
  '--init-only',
  '--input-format <format>',
  '--json-schema <schema>',
  '--maintenance',
  '--max-budget-usd <amount>',
  '--max-turns <turns>',
  '--mcp-config <configs...>',
  '--model <model>',
  '-n, --name <name>',
  '--no-chrome',
  '--no-session-persistence',
  '--output-format <format>',
  '--permission-mode <mode>',
  '--permission-prompt-tool <tool>',
  '--permission-prompts <target>',
  '--plugin-dir <path>',
  '--plugin-url <url>',
  '-p, --print',
  '--prompt-suggestions [value]',
  '--rc [name]',
  '--ref <ref>',
  '--remote [description|session_id|url]',
  '--remote-control [name]',
  '--remote-control-session-name-prefix <prefix>',
  '--replay-user-messages',
  '--restricted',
  '-r, --resume [value]',
  '--safe-mode',
  '--session-id <uuid>',
  '--setting-sources <sources>',
  '--settings <file-or-json>',
  '--strict-mcp-config',
  '--system-prompt <prompt>',
  '--system-prompt-file <file>',
  '--system-prompt-snapshot <on|off>',
  '--teammate-mode <mode>',
  '--teleport [session]',
  '--tmux',
  '--tools <tools...>',
  '--verbose',
  '-v, --version',
  '-w, --worktree [name]',
];

const camel = (flag) => flag.replace(/^-+/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());

// Each flag, short and long, to `{ name, kind }`: kind is 'flag', 'value',
// 'optional' or 'list'; name is the first long flag in camelCase, as in
// `allowedTools` for both `--allowedTools` and `--allowed-tools`.
const OPTIONS = new Map();
for (const line of SPEC) {
  const [, flags, open, list] = line.match(/^(.*?)(?: ([<[])[^>\]]*?(\.\.\.)?[>\]])?$/);
  const names = flags.split(', ');
  const kind = !open ? 'flag' : open === '[' ? 'optional' : list ? 'list' : 'value';
  const option = { name: camel(names.find((n) => n.startsWith('--'))), kind };
  for (const n of names) OPTIONS.set(n, option);
}

const optionLike = (arg) => arg.length > 1 && arg[0] === '-';

// Reads one argv (without `claude` itself). Returns `{ print, promptFirst,
// next, prompt, operands, flags, unknown }`: `print` when `-p` or `--print`
// is there; `next`, what comes right after the first one; `promptFirst`
// when that is the prompt; `prompt`, the first argument that is neither an
// option nor a value; `flags`, by name, `true` for a flag (or an optional
// value left out), a string for a value (null when it's missing; the last
// one wins) and an array for a list (repeats add up); `unknown`, options
// Claude Code doesn't know, which make it stop with an error before the run.
export function parseClaudeArgs(argv) {
  const flags = {};
  const operands = [];
  const unknown = [];
  // `rest` marks what is left of a token after a combined short flag.
  const queue = argv.map((text, at) => ({ text, at }));
  let list = null;
  let print = null;
  const set = (option, value) => {
    if (option.kind === 'list') flags[option.name] = [...(flags[option.name] ?? []), value];
    else flags[option.name] = value;
  };
  // Where the prompt must be when -p ends its token, or what follows it in
  // the same token, as in `-pc`.
  const printed = (item, rest) => {
    if (print) return;
    print = rest ? { next: `-${rest}` } : { at: item.at + 1, next: argv[item.at + 1] };
  };
  while (queue.length) {
    const item = queue.shift();
    const arg = item.text;
    if (arg === '--' && !item.rest) {
      operands.push(...queue);
      break;
    }
    if (list && !optionLike(arg)) {
      set(list, arg);
      continue;
    }
    list = null;
    const option = optionLike(arg) ? OPTIONS.get(arg) : undefined;
    if (option) {
      if (option.kind === 'flag') {
        set(option, true);
        if (option.name === 'print') printed(item);
      } else if (option.kind === 'optional') {
        set(option, queue.length && !optionLike(queue[0].text) ? queue.shift().text : true);
      } else {
        set(option, queue.length ? queue.shift().text : null);
        if (option.kind === 'list') list = option;
      }
      continue;
    }
    const short = arg.length > 2 && arg[0] === '-' && arg[1] !== '-' && OPTIONS.get(`-${arg[1]}`);
    if (short) {
      if (short.kind === 'flag') {
        set(short, true);
        if (short.name === 'print') printed(item, arg.slice(2));
        queue.unshift({ text: `-${arg.slice(2)}`, at: item.at, rest: true });
      } else {
        set(short, arg.slice(2));
      }
      continue;
    }
    const assigned = arg.match(/^(--[^=]+)=([\s\S]*)$/);
    const long = assigned && OPTIONS.get(assigned[1]);
    if (long && long.kind !== 'flag') {
      set(long, assigned[2]);
      continue;
    }
    if (optionLike(arg)) unknown.push(arg);
    else operands.push(item);
  }
  return {
    print: Boolean(print),
    promptFirst: Boolean(print?.at !== undefined && operands[0]?.at === print.at),
    next: print?.next,
    prompt: operands[0]?.text,
    operands: operands.map((o) => o.text),
    flags,
    unknown,
  };
}

// The entries of a tool list, such as `--allowedTools` values: split on
// commas and spaces, except inside parentheses, so `Bash(git diff *)` stays
// one entry.
export function ruleList(values) {
  const entries = [];
  for (const value of values ?? []) {
    let depth = 0;
    let current = '';
    for (const ch of String(value)) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
        if (current) entries.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) entries.push(current);
  }
  return entries;
}
