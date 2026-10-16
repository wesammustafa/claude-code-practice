// The app's own words. They state no Claude Code fact: every fact on screen
// is a quote from the lesson's content file. Tests keep commands, versions,
// model names and any claim the app can't back out of this file.
// A celebration praises the work, not how it was done: a string a
// celebration shows goes on CELEBRATIONS in checks/test/learn-content.test.mjs.

// One name for each thing the app's words talk about. The copy test rejects
// an older name, or a second way to describe the tiers.
export const TERMS = {
  practiceCopy: 'practice copy',
  // The copy of the template a-5 and the Advanced capstone have the learner make.
  newCopy: 'new copy',
  tierHelp: { guided: 'every command shown', hinted: 'the goal, hints if you ask', challenge: 'just the goal' },
  // The guide's level names, by the folder of a lesson's page.
  levels: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
};

export const C = {
  appName: 'Claude Code practice',
  levels: TERMS.levels,
  levelPath: (level) => `${level} path`,
  pathLabel: (level, done, total) => `${C.levelPath(level)} · ${done} of ${total} done`,
  pathHint: 'each stop a little harder',
  hi: (name) => `Hi ${name || 'there'}! Let's learn Claude Code by using it.`,
  pip1: `I'm Pip. I watch your ${TERMS.practiceCopy} and light up`,
  pip2: 'the moment a step works.',
  twoWindows: 'You use two windows, side by side:',
  thisWindow: 'this window',
  thisWindowLines: ['one step at a time,', 'checks your work'],
  otherWindow: 'your other terminal',
  otherWindowLines: ['where you type commands', 'and run Claude Code', '(this app checks it)'],
  openSecond: 'Open a second terminal now, in this same folder:',
  comeBack: 'Then come back here and press enter.',
  // The boot frame, while git answers the first questions at start.
  askingGit: 'Asking git about this folder…',
  gitBroken: (error) => `git isn't working here: ${error}. This isn't your work: install git, then start this app again.`,

  whyLead: 'Why:',
  youllBeAble: "You'll be able to",
  helpShrinks: 'The help shrinks each time a skill comes back:',
  tierHelp: TERMS.tierHelp,
  startLesson: (n) => `Start lesson ${n}`,
  startCapstone: 'Start the capstone',
  lessHelp: "I've used Claude Code before: give me less help",
  steps: (n) => `${n} steps`,
  stepOf: (n, m) => `step ${n} of ${m}`,

  where: { terminal: 'in your other terminal', claude: 'in Claude Code', shell: 'in a third terminal', editor: 'in your editor', predict: 'guess first', ask: 'quick question', type: 'from memory', self: 'self-check' },
  warmup: (n, level) => `Warm-up from ${level ? `${level} lesson` : 'lesson'} ${n}`,
  warmupWhy: "A warm-up brings back an earlier lesson from memory. A wrong answer is fine: you see the lesson's words at once.",
  warmups: (n) => `${n} warm-up${n === 1 ? '' : 's'} first`,
  done: 'DONE',
  doneWhen: 'Done when ',
  noCommands: 'No commands this time.',
  doneEachPart: "You've done each part before.",
  watching: (what) => [`Watching `, what, ". I'll turn green the moment it's right."],
  staleWatch: (what) => [`Watching `, what, ". It's from an earlier step: I'll turn green once you make it again."],
  fileEmpty: (path) => `${path} has no line in it yet.`,
  andMore: (line, n) => `${line} and ${n} more line${n === 1 ? '' : 's'}`,
  slowWait: 'Part of this check takes a while, so it runs only when you ask: press r when you are ready.',
  doneBefore: { hinted: "You've done this before, so you get the goal: press h for hints.", challenge: "You've done this before, so you get just the goal." },
  watchingGit: 'Watching ',
  gitClean: 'no changes so far',
  gitDirty: (n) => `git status lists ${n} change${n === 1 ? '' : 's'}:`,
  checking: (what) => (what ? `Checking ${what}…` : 'Checking…'),
  // How far a run of several items has got, from the check child's reports.
  checkingItem: (n, m) => `Checking item ${n} of ${m}…`,
  // How long a slow check's child has run, beside the spinner.
  seconds: (n) => `${n} s`,
  notYet: 'Not yet:',
  pressH: 'Press h for help.',
  pressHAgain: 'Press h again for more help.',
  checkSays: 'The check says:',
  showExact: 'Show the exact command? y / n',
  stuckOffer: 'Stuck? Press h for a hint.',
  broken: (error) => `The check could not run: ${error}. This isn't your work. Press r to try again.`,
  gitFailAfter: 'Press r to look again.',
  stepDone: (n) => `Step ${n} done!`,
  holds: (path) => [path, ' holds '],
  cleanCopy: `Your ${TERMS.practiceCopy} is clean: nothing to commit.`,
  session: (n) => `${n} step${n === 1 ? '' : 's'} this session`,
  beatDone: 'Done.',
  already: 'Already done: the check already passes, so this step counts.',
  alreadyCheck: 'The check already passes, so this step counts.',
  hintsLater: (via) => (via === 'pick' ? 'Try it first: pick an answer, then h works.' : 'Try it first: press r to check, then h works.'),
  pickFirst: 'Pick an answer first: a number, or the arrows.',
  why: 'Why this matters, in the lesson\'s words:',

  guessFirst: 'Guess:',
  safetyChoice: 'A safety choice.',
  anyAnswer: 'Any answer is fine: nothing is scored.',
  guessRight: 'Your guess was right.',
  nowYouKnow: 'Now you know:',
  findOutAt: (n) => `Got it. You'll find out at step ${n}.`,
  youGuessed: (text) => `You guessed: ${text}`,
  right: 'Right.',
  answered: 'Answered.',
  notQuite: 'Not quite.',
  trueOfElse: "That's true of something else. The lesson says:",
  lookAgain: 'Look again, or press s to see the answer.',
  lookFor: 'Look for',
  theAnswer: "The answer, in the lesson's words:",
  theAnswerIs: (n) => `It's option ${n}.`,
  fixFirst: "That's the fix, in the lesson's words:",
  fixThenPick: 'Fix it, then pick again.',
  otherFine: "That's fine.",
  stillStuck: 'Still stuck? Press p for the lesson page and the Stuck link.',
  lastQuestion: 'Last question',
  typeIt: 'Type it and press enter. No options this time.',
  emptyShows: 'Not sure? Press enter on an empty line to see the answer.',
  checkPasses: (n, m) => [`passes: ${n} of ${m} item${m === 1 ? '' : 's'}.`],
  runItToo: (place) => `Run it ${place} too: you will see the same result.`,
  eased: 'A little more help on this one: you needed help with it last time.',
  stray: "That looks like a command. Type it in your other terminal, not here.",

  levelUp: 'LEVEL UP',
  toHinted: ["You've done each of these once, with every command shown.", 'From here you get the goal. Press h when you want a hint.'],
  toChallenge: ['From memory now: just the goal.', 'Try it first, then press h if you need a hint.'],
  nextCounts: (h, c) => `Still to come: ${[h && `${h} hinted step${h === 1 ? '' : 's'}`, c && `${c} challenge${c === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}.`,

  complete: 'COMPLETE',
  lessonDone: (label) => `${label} done! You practised:`,
  badge: (name) => `New badge: ${name}`,
  checkedSummary: (n, m) => `The lesson's check passes: ${n} of ${m} item${m === 1 ? '' : 's'}`,
  handover: 'You did every task without the exact command.',
  // On each level's capstone next screen only: inside a level, the next
  // lesson expects a clean tree.
  invitation: 'Questions about anything in this level? Ask in your other terminal, then compare the answer with the lesson pages.',
  answeredSummary: (n) => `${n} question${n === 1 ? '' : 's'} answered`,
  yourClimb: 'Your climb',
  nextUp: 'Next up',
  notchHarder: 'A notch harder: it starts with less help.',
  savedBreak: 'Your progress is saved, so a break is fine. Come back with npm run learn.',
  goFurther: 'Go further:',

  map: 'MAP',
  help: 'Help:',
  mapFooter: 'Each lesson reuses what came before, so it starts with less help.',
  mapDone: 'done',
  mapNext: 'next',
  ofDone: (n, m) => `${n} of ${m} done`,

  checkOnly: ["This lesson isn't in the app yet. Follow the lesson page,", "and I'll watch its check for you:"],
  newCopy: [`This lesson runs in a ${TERMS.newCopy} of the template, so I don't`, `check it in this ${TERMS.practiceCopy}. Its check looks for:`],
  newCopyPlain: `runs in a ${TERMS.newCopy} of the template, so it is not checked here`,
  // Which items the check-only card shows, where they don't all fit.
  itemsShown: (a, b, n) => `Items ${a} to ${b} of ${n}`,
  itemOf: (a, n) => `Item ${a} of ${n}`,

  welcomeBack: 'Welcome back!',
  restartAsk: 'Start this lesson over? Your answers and ticks for it are cleared.',
  saveFailed: (error) => `Couldn't save your place: ${error}. The app keeps going.`,
  youreOn: (label, n, m, title) => `You're on ${label}, step ${n} of ${m}: ${title}.`,

  cardTitle: 'Your card',
  cardIntro: "The commands from steps you finished, in the lessons' words.",
  cardEmpty: 'Nothing here yet: commands show up here as you finish the steps that use them.',
  cardLink: 'Commands by level, in the guide:',
  // Recall, then compare: the next screen asks, space shows the entries.
  // A lesson's entries can be keys or a git command, and there can be one:
  // the words name neither a kind nor a number.
  recallAsk: (label) => `Say to yourself what ${label} taught you, then press space.`,
  compareTitle: (label) => `${label}, on your card`,
  compareIntro: "Compare what you said with the lesson's own words.",

  pageTitle: 'The lesson page',
  stuckLink: 'Stuck? Tell us here:',

  keysTitle: 'Keys',
  keyHelp: [
    ['enter', 'next, or choose'],
    ['space', 'I did it'],
    ['↑ ↓  1-9', 'move, or pick an answer'],
    ['h', 'a hint, one at a time'],
    ['r', 'check again now'],
    ['w', 'why this matters'],
    ['b', 'back one screen'],
    ['m', 'the map of lessons'],
    ['p', 'the lesson page and what to read next'],
    ['?', 'these keys'],
    ['q', 'quit (your place is saved)'],
  ],
  // Listed under the arrows where the course has more than one level.
  levelKey: ['← →', 'the map: another level'],
  // Listed only where the ? overlay has a row to spare.
  cardKey: ['c', 'your card: commands from finished steps'],
  calm: 'Prefer a still screen? Quit, then start with npm run learn -- --calm.',

  small: 'Make this window a bit bigger (at least 60 by 20).',
  savedAt: (label, n, m) => `Saved: ${label}, step ${n} of ${m}. Run npm run learn to pick up where you left off.`,
  savedLater: 'Your place is saved once .practice/ exists (lesson 1, step 3).',
  plainIntro: 'npm run learn shows one step at a time in a terminal. Run it in a terminal window to use it.',
  usage: 'Usage: npm run learn -- [--calm] [--plain]. --calm keeps the screen still; --plain draws plain symbols with no color.',

  k: {
    itsOpen: "it's open", quit: 'quit', choose: 'choose', start: 'start', map: 'map', more: 'more', checkNow: 'check now',
    checkAgain: 'check again', moreHelp: 'more help', help: 'help', hint: 'hint', anotherHint: 'another hint', why: 'why', back: 'back',
    next: 'next', nextTo: (title) => `next: ${title}`, answer: 'answer', showAnswer: 'show answer', letsGo: "let's go",
    bringIt: 'bring it on', whatsNext: "what's next", startN: (label) => `start ${label}`, open: 'open',
    continue: 'continue', startOver: 'start over', yesStartOver: 'yes, start over', keep: 'no, keep it', close: 'close', scroll: 'scroll', level: 'level', card: 'card', yes: 'show it', no: 'not yet', page: 'page', clear: 'clear',
  },
};
