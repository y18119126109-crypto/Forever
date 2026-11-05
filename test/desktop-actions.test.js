const assert = require('node:assert/strict');
const test = require('node:test');

const desktopActions = require('../src/desktop-actions');

test('QQ login cookie serialization only keeps required qq.com values', () => {
  const cookie = desktopActions.serializeQqMusicCookies([
    { domain: '.qq.com', name: 'uin', value: '10001' },
    { domain: 'y.qq.com', name: 'qm_keyst', value: 'music-token' },
    { domain: '.qq.com', name: 'unrelated', value: 'private-value' },
    { domain: '.example.com', name: 'qqmusic_key', value: 'wrong-domain' }
  ]);
  assert.equal(cookie, 'uin=10001; qm_keyst=music-token');
});

test('desktop QQ login bridge reports waiting and successful states', async () => {
  let callbacks;
  let savedCookie = '';
  desktopActions.registerQqMusicLogin(async (value) => {
    callbacks = value;
  });

  const waiting = await desktopActions.startQqMusicLogin(async (cookie) => {
    savedCookie = cookie;
  });
  assert.equal(waiting.available, true);
  assert.equal(waiting.active, true);
  assert.equal(waiting.status, 'waiting');

  await callbacks.complete('uin=10001; qm_keyst=test');
  assert.equal(savedCookie, 'uin=10001; qm_keyst=test');
  assert.deepEqual(desktopActions.getQqMusicLoginStatus(), {
    available: true,
    active: false,
    status: 'success',
    message: 'QQ 音乐登录成功'
  });
});
