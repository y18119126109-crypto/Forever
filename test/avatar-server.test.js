const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('avatar endpoints serve bundled and uploaded images, recover missing files and migrate legacy defaults', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'forever-avatar-test-'));
  process.env.SWAGGER_DATA_DIR = dataRoot;
  process.env.SWAGGER_ENV_FILE = path.join(dataRoot, '.env');
  process.env.CLAUDE_DISABLED = '1';
  process.env.CODEX_DISABLED = '1';
  const service = require('../src/server');
  const state = require('../src/state');
  const settings = require('../src/settings');
  const paths = require('../src/paths');
  // No third-party music service is needed for the image API.
  require('../src/music').resolveQueue = async () => [];
  const { url } = await service.startServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    await service.stopServer();
    await new Promise((resolve, reject) => state.db.close(e => e ? reject(e) : resolve()));
    await fs.rm(dataRoot, { recursive: true, force: true });
  });
  const bundled = await fs.readFile(paths.DEFAULT_AVATAR_PATH);
  for (const endpoint of ['/api/avatar', '/api/avatar/default']) {
    const response = await fetch(url + endpoint, { redirect: 'manual' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bundled);
    assert.equal((await fetch(url + endpoint, { method: 'HEAD' })).status, 200);
  }
  const uploadBytes = await fs.readFile(path.join(paths.PUBLIC_DIR, 'assets/forever-icon-192.png'));
  const response = await fetch(url + '/api/settings/avatar', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: uploadBytes
  });
  assert.equal(response.status, 200);
  const { avatarUrl } = await response.json();
  assert.match(avatarUrl, /^\/uploads\/avatar-[a-f0-9]{20}\.png$/);
  assert.deepEqual(Buffer.from(await (await fetch(url + '/api/avatar')).arrayBuffer()), uploadBytes);
  const selectedFile = path.join(paths.UPLOADS_DIR, path.basename(avatarUrl));
  await fs.unlink(selectedFile);
  assert.deepEqual(Buffer.from(await (await fetch(url + '/api/avatar')).arrayBuffer()), bundled);
  assert.equal((await settings.getSettings()).avatarUrl, avatarUrl, 'Do not erase recoverable selection');
  await fs.writeFile(selectedFile, 'invalid image');
  assert.deepEqual(Buffer.from(await (await fetch(url + '/api/avatar')).arrayBuffer()), bundled);

  await state.setPref('debug_settings', {
    avatarUrl: 'https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?old-default',
    assistantName: 'Swagger', genres: ['JAZZ'], recommendation: { responseMode: 'interactive' }
  });
  const migrated = await settings.getSettings();
  assert.equal(migrated.avatarUrl, '/api/avatar/default');
  assert.equal(migrated.assistantName, 'Forever');
  assert.equal(migrated.recommendation.responseMode, 'interactive');
  assert.equal((await settings.updateSettings({ assistantName: '我的 DJ' })).assistantName, '我的 DJ');
  assert.equal((await settings.resetAvatar()).avatarUrl, '/api/avatar/default');
});
