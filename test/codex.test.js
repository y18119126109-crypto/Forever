const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.CODEX_COMMAND = path.join(__dirname, 'fixtures/fake-codex.js');
process.env.CODEX_TIMEOUT_MS = '5000';
process.env.FAKE_CODEX_LOGGED_IN = '1';

const codex = require('../src/codex');

test('detects an installed Codex CLI with ChatGPT authentication', () => {
  const status = codex.status(true);
  assert.equal(status.installed, true);
  assert.equal(status.loggedIn, true);
  assert.equal(status.authMode, 'chatgpt');
  assert.equal(status.version, 'codex-cli 0.test');
});

test('runs the Codex CLI login command and refreshes authentication', async () => {
  const status = await codex.login();
  assert.equal(status.loggedIn, true);
  assert.equal(status.authMode, 'chatgpt');
});

test('returns the structured DJ response from codex exec', async () => {
  const response = await codex.complete(
    '推荐一首适合测试的歌曲。',
    { model: '' },
    'Swagger'
  );

  assert.deepEqual(response.value, {
    say: '用 Codex 继续。',
    play: ['测试歌曲'],
    reason: '模拟 Codex CLI 响应。',
    segue: '',
    playerAction: 'play'
  });
  assert.equal(response.model, 'codex-default');
  assert.equal(response.usage, null);
});
