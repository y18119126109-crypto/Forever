const trackCache = new Map();
const sourceCache = new Map();

const QQ_ID_PATTERN = /^[A-Za-z0-9]{6,64}$/;

function sourceIdFromTrackId(value) {
  const match = String(value || '').match(/^qq:([A-Za-z0-9]{6,64})$/);
  return match ? match[1] : null;
}

function coverUrl(albumMid) {
  return albumMid
    ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
    : '';
}

function normalizeSong(input = {}) {
  const song = input.track_info || input;
  const sourceId = String(song.songmid || song.mid || '').trim();
  if (!QQ_ID_PATTERN.test(sourceId)) return null;
  const singers = Array.isArray(song.singer) ? song.singer : [];
  const albumMid = song.albummid || song.album?.mid || '';
  const track = {
    id: `qq:${sourceId}`,
    provider: 'qq',
    sourceId,
    mediaId: song.strMediaMid || song.file?.media_mid || sourceId,
    title: song.songname || song.title || song.name || 'Unknown Track',
    artist: singers.map((artist) => artist.name).filter(Boolean).join(' / ')
      || song.singername
      || 'Unknown Artist',
    duration: Math.max(1, Math.round(Number(song.interval || 180))),
    album: song.albumname || song.album?.name || '',
    albumMid,
    coverUrl: coverUrl(albumMid),
    url: null
  };
  trackCache.set(track.id, track);
  return track;
}

async function request(config, pathname, params = {}) {
  const baseUrl = String(config?.qqBaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('QQMusicApi Base URL is not configured');
  const url = new URL(pathname, `${baseUrl}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(config.qqCookie ? { Cookie: config.qqCookie } : {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`QQMusicApi returned ${response.status}`);
    if (payload.result !== undefined && Number(payload.result) !== 100) {
      throw new Error(payload.errMsg || `QQMusicApi returned result ${payload.result}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function search(config, query, limit = 6) {
  const payload = await request(config, '/search', {
    key: query,
    pageNo: 1,
    pageSize: Math.max(1, Math.min(30, Number(limit) || 6)),
    t: 0
  });
  return (payload.data?.list || []).map(normalizeSong).filter(Boolean);
}

async function songDetails(config, trackId) {
  const sourceId = sourceIdFromTrackId(trackId);
  if (!sourceId) return null;
  const cached = trackCache.get(`qq:${sourceId}`);
  if (cached) return cached;
  const payload = await request(config, '/song', { songmid: sourceId });
  return normalizeSong(payload.data?.track_info || payload.data || {});
}

async function songSource(config, trackId, options = {}) {
  const sourceId = sourceIdFromTrackId(trackId);
  if (!sourceId) return { url: null, provider: 'qq', quality: '' };
  const track = trackCache.get(`qq:${sourceId}`) || await songDetails(config, trackId).catch(() => null);
  const qualities = [...new Set([config.qqQuality, '320', '128', 'm4a'].filter(Boolean))];

  for (const quality of qualities) {
    const key = `${String(config.qqBaseUrl || '').replace(/\/+$/, '')}:${sourceId}:${quality}`;
    const cached = sourceCache.get(key);
    if (
      !options.force
      && cached
      && cached.cookie === config.qqCookie
      && cached.expiresAt > Date.now()
    ) {
      return cached.value;
    }
    try {
      const payload = await request(config, '/song/url', {
        id: sourceId,
        mediaId: track?.mediaId || sourceId,
        type: quality,
        ownCookie: 1
      });
      if (!payload.data || typeof payload.data !== 'string') continue;
      const value = {
        url: payload.data,
        provider: 'qq',
        quality,
        requestedQuality: config.qqQuality,
        encodeType: quality === 'flac' ? 'flac' : quality === 'm4a' ? 'm4a' : 'mp3',
        sourceDuration: track?.duration || 0,
        isTrial: false
      };
      sourceCache.set(key, {
        cookie: config.qqCookie,
        value,
        expiresAt: Date.now() + (5 * 60 * 1000)
      });
      return value;
    } catch (error) {
      // A higher quality can be unavailable for the current account or track.
    }
  }
  return {
    url: null,
    provider: 'qq',
    quality: '',
    requestedQuality: config.qqQuality,
    encodeType: ''
  };
}

function parseLrc(source) {
  const lines = [];
  String(source || '').split(/\r?\n/).forEach((row) => {
    const timestamps = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = row.replace(/\[[^\]]+\]/g, '').trim();
    if (!timestamps.length || !text) return;
    timestamps.forEach((match) => {
      const milliseconds = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
      lines.push({
        time: (Number(match[1]) * 60) + Number(match[2]) + (milliseconds / 1000),
        text
      });
    });
  });
  return lines.sort((left, right) => left.time - right.time);
}

async function lyricData(config, trackId) {
  const sourceId = sourceIdFromTrackId(trackId);
  if (!sourceId) return { lyric: '', trans: '' };
  const payload = await request(config, '/lyric', { songmid: sourceId });
  return payload.data || {};
}

async function lyrics(config, trackId) {
  const data = await lyricData(config, trackId);
  const original = parseLrc(data.lyric);
  const translations = new Map(
    parseLrc(data.trans).map((line) => [line.time.toFixed(3), line.text])
  );
  return original.map((line) => ({
    ...line,
    translation: translations.get(line.time.toFixed(3)) || ''
  }));
}

async function lyric(config, trackId) {
  return (await lyricData(config, trackId)).lyric || '';
}

async function artwork(config, trackId) {
  const track = trackCache.get(String(trackId)) || await songDetails(config, trackId);
  if (!track?.coverUrl) return null;
  return {
    id: track.id,
    album: track.album,
    source: track.coverUrl,
    provider: 'qq'
  };
}

module.exports = {
  artwork,
  coverUrl,
  lyric,
  lyrics,
  normalizeSong,
  request,
  search,
  songDetails,
  songSource,
  sourceIdFromTrackId
};
