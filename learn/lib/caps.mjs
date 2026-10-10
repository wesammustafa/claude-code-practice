// What the learner's terminal can show. LEARN_PLAIN=1 asks for plain ASCII
// with no color, for terminals where the symbols come out wrong.
export function unicodeLikely(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return env.TERM !== 'linux';
  // The old Windows console host can't draw emoji or most symbols; these
  // terminals can.
  return Boolean(env.WT_SESSION || env.TERMINUS_SUBLIME || env.ConEmuTask === '{cmd::Cmder}'
    || env.TERM_PROGRAM === 'vscode' || env.TERM === 'xterm-256color' || env.TERM === 'alacritty'
    || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm');
}

export function capabilities(stream = process.stdout, env = process.env, platform = process.platform) {
  const plain = env.LEARN_PLAIN === '1';
  const tty = Boolean(stream.isTTY);
  let depth = tty && typeof stream.getColorDepth === 'function' ? stream.getColorDepth(env) : 1;
  if (plain || env.NO_COLOR) depth = 1;
  const unicode = !plain && unicodeLikely(env, platform);
  // OSC 8 hyperlinks: shown as text with the URL beside it everywhere, and
  // clickable where the terminal is known to support them.
  const links = !plain && Boolean(env.WT_SESSION || env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'WezTerm' || env.KITTY_WINDOW_ID || env.VTE_VERSION);
  return { tty, depth, unicode, links, win32: platform === 'win32', codespace: env.CODESPACES === 'true' };
}
