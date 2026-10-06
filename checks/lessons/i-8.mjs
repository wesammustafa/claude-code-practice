// Install and manage plugins (Intermediate, lesson 8). The Learner enables a
// plugin from one of Anthropic's marketplaces for the whole project, in the
// committed .claude/settings.json, installs it at project scope, and saves
// `claude plugin list --json` so the check can see the install.
import { realpathSync } from 'node:fs';

export const title = 'Install and manage plugins';

const ANTHROPIC = ['claude-plugins-official', 'claude-community', 'claude-code-plugins'];
const SAVE = '`claude plugin list --json > .practice/i-8-plugins.json`';

// Whether an install's projectPath is this repository: true or false when the
// path exists on this machine, null when it doesn't (a list saved elsewhere).
function here(projectPath, dir) {
  try {
    return realpathSync(projectPath) === realpathSync(dir);
  } catch {
    return null;
  }
}

function projectPlugins(repo) {
  try {
    const value = JSON.parse(repo.git('show', 'HEAD:.claude/settings.json'));
    return Object.entries(value?.enabledPlugins ?? {})
      .filter(([id, on]) => on === true && ANTHROPIC.includes(id.split('@')[1]))
      .map(([id]) => id);
  } catch {
    return null;
  }
}

export const items = [
  {
    text: 'the committed `.claude/settings.json` enables a plugin from one of Anthropic\'s marketplaces',
    check(repo) {
      const ids = projectPlugins(repo);
      if (ids === null) return 'There is no committed .claude/settings.json that parses as JSON. Add the `enabledPlugins` entry from the lesson and commit it.';
      return ids.length ? true : `Its \`enabledPlugins\` turns on no plugin from Anthropic's marketplaces. Add \`"claude-code-setup@claude-plugins-official": true\`: the part after @ is the marketplace's name, one of ${ANTHROPIC.join(', ')}.`;
    },
  },
  {
    text: '`.practice/i-8-plugins.json`, saved in this repository, shows that plugin installed at project scope and enabled',
    local: true,
    check(repo) {
      const text = repo.read('.practice/i-8-plugins.json');
      if (text === null) return `In the repository, run ${SAVE}.`;
      let list;
      try {
        list = JSON.parse(text);
      } catch {
        return `.practice/i-8-plugins.json isn't JSON. Run ${SAVE} again, from the repository's root.`;
      }
      const ids = projectPlugins(repo) ?? [];
      // The list holds project-scope installs for every project on the machine,
      // and projectEnabled reflects the settings of the folder it ran in, so an
      // install counts only when its projectPath is this repository.
      const ok = (Array.isArray(list) ? list : list?.installed ?? []).some((p) => ids.includes(p?.id) && p.scope === 'project' && p.enabled === true && p.projectEnabled === true && here(p.projectPath, repo.dir) !== false);
      return ok ? true : `The saved list doesn't show ${ids[0] ?? 'the plugin'} installed at project scope for this repository. Run \`claude plugin install ${ids[0] ?? '<plugin>@<marketplace>'} --scope project\` in the repository, then ${SAVE}.`;
    },
  },
];
