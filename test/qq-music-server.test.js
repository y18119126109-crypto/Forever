const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function json(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

test('proxies QQ audio ranges and dispatches lyrics by provider id', async (t) => {
  const audio = Buffer.from('0123456789');
  const qqServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/search') {
      return json(res, {
        result: 100,
        data: {
          list: [{
            songmid: '0039MnYb0qxYhV',
            songname: 'QQ Test Track',
            singer: [{ name: 'QQ Artist' }],
            albumname: 'QQ Album',
            albummid: '000AlbumMid',
            interval: 220,
            strMediaMid: '000MediaMid'
          }]
        }
      });
    }
    if (url.pathname === '/song') {
      return json(res, {
        result: 100,
        data: {
          track_info: {
            mid: '0039MnYb0qxYhV',
            title: 'QQ Test Track',
            singer: [{ name: 'QQ Artist' }],
            album: { name: 'QQ Album', mid: '000AlbumMid' },
            interval: 220,
            file: { media_mid: '000MediaMid' }
          }
        }
      });
    }
    if (url.pathname === '/song/url') {
      return json(res, {
        result: 100,
        data: `http://127.0.0.1:${qqServer.address().port}/audio.mp3`
      });
    }
    if (url.pathname === '/lyric') {
      return json(res, {
        result: 100,
        data: { lyric: '[00:01.00]QQ lyric', trans: '' }
      });
    }
    if (url.pathname === '/audio.mp3') {
      assert.equal(req.headers.referer, 'https://y.qq.com/');
      assert.equal(req.headers.range, 'bytes=0-3');
      res.writeHead(206, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': 4,
        'Content-Range': `bytes 0-3/${audio.length}`,
        'Accept-Ranges': 'bytes'
      });
      return res.end(audio.subarray(0, 4));
    }
    res.writeHead(404).end();
  });
  const qqPort = await listen(qqServer);
  t.after(() => new Promise((resolve) => qqServer.close(resolve)));

  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-qq-test-'));
  await fs.writeFile(path.join(dataRoot, '.env'), '', 'utf8');
  process.env.SWAGGER_DATA_DIR = dataRoot;
  process.env.SWAGGER_ENV_FILE = path.join(dataRoot, '.env');
  process.env.MUSIC_SOURCE = 'qq';
  process.env.QQ_MUSIC_API_BASE = `http://127.0.0.1:${qqPort}`;
  process.env.QQ_MUSIC_QUALITY = '320';
  process.env.CLAUDE_DISABLED = '1';
  delete process.env.SWAGGER_DESKTOP;

  const serverModule = require('../src/server');
  const runtime = await serverModule.startServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    await serverModule.stopServer();
    await new Promise((resolve, reject) => {
      require('../src/state').db.close((error) => error ? reject(error) : resolve());
    });
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  const settingsResponse = await fetch(`${runtime.url}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recommendation: { familiarRate: 17, responseMode: 'interactive' }
    })
  });
  assert.equal(settingsResponse.status, 200);
  assert.equal((await settingsResponse.json()).recommendation.responseMode, 'interactive');

  const integrationsResponse = await fetch(`${runtime.url}/api/integrations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      music: {
        source: 'qq',
        qqBaseUrl: `http://127.0.0.1:${qqPort}`,
        qqQuality: '320',
        qqCookie: 'uin=10001; qm_keyst=test'
      }
    })
  });
  assert.equal(integrationsResponse.status, 200);
  const publicIntegrations = await integrationsResponse.json();
  assert.equal(publicIntegrations.music.source, 'qq');
  assert.equal(publicIntegrations.music.qqCookieConfigured, true);
  assert.equal(Object.hasOwn(publicIntegrations.music, 'qqCookie'), false);

  const qqLoginStatusResponse = await fetch(`${runtime.url}/api/music/qq/login/status`);
  assert.equal(qqLoginStatusResponse.status, 200);
  assert.equal((await qqLoginStatusResponse.json()).available, false);
  const qqLoginStartResponse = await fetch(`${runtime.url}/api/music/qq/login`, {
    method: 'POST'
  });
  assert.equal(qqLoginStartResponse.status, 501);

  const encodedId = encodeURIComponent('qq:0039MnYb0qxYhV');
  const lyricResponse = await fetch(`${runtime.url}/api/track/${encodedId}/lyrics`);
  assert.equal(lyricResponse.status, 200);
  assert.deepEqual((await lyricResponse.json()).lines, [
    { time: 1, text: 'QQ lyric', translation: '' }
  ]);

  const artworkResponse = await fetch(`${runtime.url}/api/track/${encodedId}/artwork`);
  assert.equal(artworkResponse.status, 200);
  assert.equal((await artworkResponse.json()).coverUrl, `/api/track/${encodedId}/cover`);

  const audioResponse = await fetch(`${runtime.url}/api/track/${encodedId}/audio`, {
    headers: { Range: 'bytes=0-3' }
  });
  assert.equal(audioResponse.status, 206);
  assert.equal(audioResponse.headers.get('content-range'), 'bytes 0-3/10');
  assert.equal(Buffer.from(await audioResponse.arrayBuffer()).toString(), '0123');
});
