const assert = require('node:assert/strict');
const test = require('node:test');

const qqMusic = require('../src/qq-music');

const config = {
  qqBaseUrl: 'http://127.0.0.1:3300',
  qqCookie: 'uin=10001; qm_keyst=test',
  qqQuality: '320'
};

test('normalizes QQ songs with provider-safe ids and real artwork', () => {
  const track = qqMusic.normalizeSong({
    songmid: '0039MnYb0qxYhV',
    songname: 'Example',
    singer: [{ name: 'Singer A' }, { name: 'Singer B' }],
    albumname: 'Album',
    albummid: '000AlbumMid',
    interval: 245,
    strMediaMid: '000MediaMid'
  });

  assert.equal(track.id, 'qq:0039MnYb0qxYhV');
  assert.equal(track.provider, 'qq');
  assert.equal(track.sourceId, '0039MnYb0qxYhV');
  assert.equal(track.artist, 'Singer A / Singer B');
  assert.equal(track.duration, 245);
  assert.equal(
    track.coverUrl,
    'https://y.gtimg.cn/music/photo_new/T002R300x300M000000AlbumMid.jpg'
  );
});

test('uses QQMusicApi search, audio and lyric contracts', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ parsed, options });
    if (parsed.pathname === '/search') {
      return Response.json({
        result: 100,
        data: {
          list: [{
            songmid: '004Z8Ihr0JIu5s',
            songname: 'Search Result',
            singer: [{ name: 'Artist' }],
            interval: 201,
            strMediaMid: '0012Ez0a1tFcOI'
          }]
        }
      });
    }
    if (parsed.pathname === '/song/url') {
      return Response.json({
        result: 100,
        data: 'https://dl.stream.qqmusic.qq.com/test.mp3'
      });
    }
    if (parsed.pathname === '/lyric') {
      return Response.json({
        result: 100,
        data: {
          lyric: '[00:01.20]第一句\n[00:03.000]第二句',
          trans: '[00:01.20]Line one'
        }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const [track] = await qqMusic.search(config, '测试', 3);
  const source = await qqMusic.songSource(config, track.id, { force: true });
  const lines = await qqMusic.lyrics(config, track.id);

  assert.equal(track.id, 'qq:004Z8Ihr0JIu5s');
  assert.equal(source.url, 'https://dl.stream.qqmusic.qq.com/test.mp3');
  assert.equal(source.quality, '320');
  assert.deepEqual(lines, [
    { time: 1.2, text: '第一句', translation: 'Line one' },
    { time: 3, text: '第二句', translation: '' }
  ]);
  assert.equal(requests[0].parsed.searchParams.get('key'), '测试');
  assert.equal(requests[0].parsed.searchParams.get('t'), '0');
  assert.equal(requests[1].parsed.searchParams.get('ownCookie'), '1');
  assert.equal(requests[1].parsed.searchParams.get('mediaId'), '0012Ez0a1tFcOI');
  assert.equal(requests[1].options.headers.Cookie, config.qqCookie);
});
