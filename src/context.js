const fs = require('fs/promises');
const path = require('path');
const state = require('./state');
const environment = require('./environment');
const music = require('./music');
const settings = require('./settings');
const { APP_ROOT, USER_DIR } = require('./paths');

async function readText(root, relativePath, fallback = '') {
  try {
    return await fs.readFile(path.join(root, relativePath), 'utf8');
  } catch (error) {
    return fallback;
  }
}

async function buildFragments({ userInput = '', toolResult = null, actionTrail = [] } = {}) {
  const [
    persona,
    taste,
    routines,
    moodRules,
    playlists,
    env,
    messages,
    plays,
    musicAccount,
    preferences
  ] = await Promise.all([
    readText(APP_ROOT, 'prompts/dj-persona.md'),
    readText(USER_DIR, 'taste.md'),
    readText(USER_DIR, 'routines.md'),
    readText(USER_DIR, 'mood-rules.md'),
    readText(USER_DIR, 'playlists.json', '{}'),
    environment.getEnvironment(),
    state.getMessages(8),
    state.getPlays(12),
    music.userContext().catch(() => ({ loggedIn: false })),
    settings.getSettings()
  ]);

  return [
    {
      id: 'system',
      title: '系统提示词',
      content: persona
        .replaceAll('{{ASSISTANT_NAME}}', preferences.assistantName)
        .replaceAll('Claudio', preferences.assistantName)
    },
    {
      id: 'user-corpus',
      title: '用户语料',
      content: [taste, routines, moodRules, playlists].filter(Boolean).join('\n\n')
    },
    {
      id: 'environment',
      title: '环境注入',
      content: JSON.stringify(env, null, 2)
    },
    {
      id: 'music-account',
      title: '音乐来源与账号偏好',
      content: JSON.stringify(musicAccount, null, 2)
    },
    {
      id: 'memory',
      title: '已检索记忆',
      content: JSON.stringify({ messages, plays }, null, 2)
    },
    {
      id: 'input',
      title: '用户输入 / 工具结果',
      content: JSON.stringify({ userInput, toolResult }, null, 2)
    },
    {
      id: 'actions',
      title: '执行轨迹',
      content: JSON.stringify(actionTrail, null, 2)
    }
  ];
}

function serializeFragments(fragments) {
  return fragments
    .map((fragment, index) =>
      `## ${index + 1}. ${fragment.title}\n${fragment.content || '(empty)'}`
    )
    .join('\n\n');
}

async function buildContext(options = {}) {
  const fragments = await buildFragments(options);
  return {
    fragments,
    prompt: serializeFragments(fragments)
  };
}

module.exports = {
  buildContext,
  buildFragments,
  serializeFragments
};
