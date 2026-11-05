const settings = require('./settings');
const qqMusic = require('./qq-music');

const DEFAULT_TRACKS = [
  { id: 'bread-if', provider: 'fallback', sourceId: 'bread-if', title: 'If', artist: 'Bread', duration: 158, url: null },
  { id: 'night-window', provider: 'fallback', sourceId: 'night-window', title: '凌晨两点的窗', artist: 'Mellow Fields', duration: 194, url: null },
  { id: 'cold-coffee', provider: 'fallback', sourceId: 'cold-coffee', title: '咖啡冷却之前', artist: 'Sunday Archive', duration: 208, url: null },
  { id: 'neon-return', provider: 'fallback', sourceId: 'neon-return', title: '霓虹返航', artist: 'Northbound', duration: 236, url: null }
];

const API_BASE = (process.env.NCM_API_BASE || '').replace(/\/$/, '');
let directApi = null;
const cache = new Map();
const sourceCache = new Map();

try {
  directApi = require('NeteaseCloudMusicApi');
} catch (error) {
  directApi = null;
}

async function musicConfig() {
  const integrations = await settings.getRuntimeIntegrations();
  return integrations.music;
}

async function request(pathname, cookie = '') {
  if (!API_BASE) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      }
    });
    if (!response.ok) throw new Error(`Music API returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function callDirect(method, params, cookie = '') {
  if (!directApi?.[method]) return null;
  const response = await directApi[method]({
    ...params,
    cookie: cookie || undefined
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`NeteaseCloudMusicApi returned ${response.status}`);
  }
  return response.body;
}

async function cached(key, ttl, load) {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

function normalizeSong(song) {
  const artists = song.ar || song.artists || [];
  return {
    id: String(song.id),
    provider: 'netease',
    sourceId: String(song.id),
    title: song.name,
    artist: artists.map((artist) => artist.name).join(' / ') || 'Unknown Artist',
    duration: Math.max(1, Math.round((song.dt || song.duration || 180000) / 1000)),
    album: song.al?.name || song.album?.name || '',
    coverUrl: song.al?.picUrl || song.album?.picUrl || '',
    url: song.url || null
  };
}

function localAudioUrl(id, sourceUrl) {
  return sourceUrl && isProviderTrackId(id)
    ? `/api/track/${encodeURIComponent(id)}/audio`
    : sourceUrl;
}

function trackProvider(id) {
  return qqMusic.sourceIdFromTrackId(id) ? 'qq' : /^\d{1,20}$/.test(String(id))
    ? 'netease'
    : 'fallback';
}

function isProviderTrackId(id) {
  return ['netease', 'qq'].includes(trackProvider(id));
}

async function searchNetease(query, limit = 5) {
  const { cookie } = await musicConfig();
  let data;
  try {
    data = directApi
      ? await callDirect('cloudsearch', { keywords: query, limit, type: 1 }, cookie)
      : await request(
        `/cloudsearch?keywords=${encodeURIComponent(query)}&limit=${limit}&type=1`,
        cookie
      );
  } catch (error) {
    if (!cookie) throw error;
    data = directApi
      ? await callDirect('cloudsearch', { keywords: query, limit, type: 1 })
      : await request(`/cloudsearch?keywords=${encodeURIComponent(query)}&limit=${limit}&type=1`);
  }
  if (!data) {
    const needle = query.toLowerCase();
    const matches = DEFAULT_TRACKS.filter((track) =>
      `${track.title} ${track.artist}`.toLowerCase().includes(needle)
    );
    if (matches.length) return matches.slice(0, limit);
    const offset = [...needle].reduce((sum, character) => sum + character.charCodeAt(0), 0)
      % DEFAULT_TRACKS.length;
    return [...DEFAULT_TRACKS.slice(offset), ...DEFAULT_TRACKS.slice(0, offset)].slice(0, limit);
  }
  return (data.result?.songs || []).map(normalizeSong);
}

async function search(query, limit = 5) {
  const config = await musicConfig();
  const providers = config.source === 'auto'
    ? ['netease', 'qq']
    : [config.source];
  for (const provider of providers) {
    try {
      const tracks = provider === 'qq'
        ? await qqMusic.search(config, query, limit)
        : await searchNetease(query, limit);
      if (tracks.length) return tracks;
    } catch (error) {
      // In automatic mode, an unavailable provider must not block the fallback.
    }
  }
  return [];
}

async function neteaseSongSource(id, options = {}) {
  const { cookie, quality } = await musicConfig();
  const cacheKey = `${id}:${quality}`;
  const cachedSource = sourceCache.get(cacheKey);
  if (
    !options.force
    && cachedSource
    && cachedSource.cookie === cookie
    && cachedSource.expiresAt > Date.now()
  ) {
    return cachedSource.value;
  }

  const levels = [...new Set([quality, 'exhigh', 'standard'])];
  for (const level of levels) {
    const timestamp = Date.now();
    let data;
    try {
      data = directApi
        ? await callDirect('song_url_v1', { id, level, timestamp }, cookie)
        : await request(
          `/song/url/v1?id=${encodeURIComponent(id)}&level=${encodeURIComponent(level)}&timestamp=${timestamp}`,
          cookie
        );
    } catch (error) {
      if (!cookie) throw error;
      data = directApi
        ? await callDirect('song_url_v1', { id, level, timestamp })
        : await request(
          `/song/url/v1?id=${encodeURIComponent(id)}&level=${encodeURIComponent(level)}&timestamp=${timestamp}`
        );
    }
    const source = data?.data?.[0];
    if (source?.url) {
      // #region debug-point C:netease-source
      fetch(process.env.DEBUG_SERVER_URL || 'http://127.0.0.1:7777/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'desktop-audio-truncation',
          runId: 'post-fix',
          hypothesisId: 'C',
          location: 'src/music.js:songSource',
          msg: '[DEBUG] resolved NetEase audio source',
          data: {
            trackId: String(id),
            hasCookie: Boolean(cookie),
            requestedQuality: quality,
            resolvedLevel: source.level || level,
            size: Number(source.size || 0),
            time: Number(source.time || 0),
            code: Number(source.code || 0),
            fee: Number(source.fee || 0),
            hasFreeTrialInfo: Boolean(source.freeTrialInfo),
            hasFreeTimeTrialPrivilege: Boolean(source.freeTimeTrialPrivilege),
            sourceHost: (() => {
              try {
                return new URL(source.url).host;
              } catch (error) {
                return '';
              }
            })()
          },
          traceId: `${id}-${timestamp}`,
          ts: Date.now()
        })
      }).catch(() => {});
      // #endregion
      const value = {
        url: source.url,
        quality: source.level || level,
        requestedQuality: quality,
        encodeType: source.encodeType || '',
        sourceDuration: Math.max(0, Math.round(Number(source.time || 0) / 1000)),
        isTrial: Boolean(source.freeTrialInfo)
      };
      if (value.isTrial) continue;
      sourceCache.set(cacheKey, {
        cookie,
        value,
        expiresAt: Date.now() + (5 * 60 * 1000)
      });
      return value;
    }
  }
  return { url: null, quality: '', requestedQuality: quality, encodeType: '' };
}

async function songSource(id, options = {}) {
  const config = await musicConfig();
  if (trackProvider(id) === 'qq') return qqMusic.songSource(config, id, options);
  if (trackProvider(id) === 'netease') return neteaseSongSource(id, options);
  return { url: null, quality: '', requestedQuality: '', encodeType: '' };
}

async function songUrl(id) {
  return (await songSource(id)).url;
}

async function neteaseLyricData(id) {
  const { cookie } = await musicConfig();
  return cached(`lyric:${id}`, 30 * 60 * 1000, () => (
    directApi
      ? callDirect('lyric', { id }, cookie)
      : request(`/lyric?id=${encodeURIComponent(id)}`, cookie)
  ));
}

async function lyric(id) {
  if (trackProvider(id) === 'qq') return qqMusic.lyric(await musicConfig(), id);
  const data = await neteaseLyricData(id);
  return data?.lrc?.lyric || '';
}

function parseLrc(source) {
  const lines = [];
  String(source || '').split(/\r?\n/).forEach((row) => {
    const timestamps = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!timestamps.length) return;
    const text = row.replace(/\[[^\]]+\]/g, '').trim();
    if (!text) return;
    timestamps.forEach((match) => {
      const fraction = match[3] || '0';
      const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
      lines.push({
        time: (Number(match[1]) * 60) + Number(match[2]) + (milliseconds / 1000),
        text
      });
    });
  });
  return lines.sort((left, right) => left.time - right.time);
}

async function lyrics(id) {
  if (trackProvider(id) === 'qq') return qqMusic.lyrics(await musicConfig(), id);
  const data = await neteaseLyricData(id);
  const original = parseLrc(data?.lrc?.lyric);
  const translations = new Map(
    parseLrc(data?.tlyric?.lyric).map((line) => [line.time.toFixed(3), line.text])
  );
  return original.map((line) => ({
    ...line,
    translation: translations.get(line.time.toFixed(3)) || ''
  }));
}

function normalizeComment(comment, kind) {
  return {
    id: String(comment.commentId || ''),
    kind,
    user: comment.user?.nickname || '网易云用户',
    content: String(comment.content || '').trim(),
    likedCount: Number(comment.likedCount || 0),
    time: Number(comment.time || 0),
    timeLabel: comment.timeStr || ''
  };
}

async function comments(id, limit = 20) {
  if (trackProvider(id) === 'qq') return { total: 0, items: [], provider: 'qq' };
  const safeLimit = Math.max(1, Math.min(30, Number(limit) || 20));
  const { cookie } = await musicConfig();
  const data = await cached(`comments:${id}:${safeLimit}`, 2 * 60 * 1000, () => (
    directApi
      ? callDirect('comment_music', { id, limit: safeLimit, offset: 0 }, cookie)
      : request(
        `/comment/music?id=${encodeURIComponent(id)}&limit=${safeLimit}&offset=0`,
        cookie
      )
  ));
  const seen = new Set();
  const items = [
    ...(data?.hotComments || []).map((comment) => normalizeComment(comment, 'hot')),
    ...(data?.comments || []).map((comment) => normalizeComment(comment, 'recent'))
  ].filter((comment) => {
    if (!comment.id || !comment.content || seen.has(comment.id)) return false;
    seen.add(comment.id);
    return true;
  }).slice(0, safeLimit);
  return { total: Number(data?.total || items.length), items };
}

async function recommend(limit = 6) {
  const config = await musicConfig();
  if (config.source === 'qq') return [];
  const { cookie } = config;
  const data = directApi
    ? await callDirect('personalized_newsong', { limit }, cookie)
    : await request(`/personalized/newsong?limit=${limit}`, cookie);
  if (!data) return DEFAULT_TRACKS.slice(0, limit);
  return (data.result || []).map((item) => normalizeSong(item.song || item));
}

function uniqueTracks(tracks, excluded = new Set()) {
  const seen = new Set(excluded);
  return tracks.filter((track) => {
    const id = String(track?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function interleaveTrackLists(lists) {
  const result = [];
  const maxLength = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < maxLength; index += 1) {
    lists.forEach((list) => {
      if (list[index]) result.push(list[index]);
    });
  }
  return result;
}

async function hydrateCandidates(candidates, limit) {
  const hydrated = [];
  for (let offset = 0; offset < candidates.length && hydrated.length < limit; offset += 4) {
    const batch = await Promise.all(
      candidates.slice(offset, offset + 4).map(async (track) => {
        try {
          const source = track.url ? {
            url: track.url,
            quality: track.quality || '',
            requestedQuality: track.requestedQuality || '',
            encodeType: track.encodeType || ''
          } : await songSource(track.id);
          if (!source.url) return null;
          return {
            ...track,
            ...source,
            url: localAudioUrl(track.id, source.url)
          };
        } catch (error) {
          return null;
        }
      })
    );
    hydrated.push(...batch.filter(Boolean));
  }
  return hydrated.slice(0, limit);
}

async function resolveSearchPool(
  queries,
  limit = 12,
  excludeIds = [],
  requiredPattern = null
) {
  const safeLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  const config = await musicConfig();
  const groups = await Promise.all(
    queries.map((query) => search(query, 8).catch(() => []))
  );
  const candidates = uniqueTracks(groups.flat(), new Set(excludeIds.map(String)))
    .filter((track) => {
      if (!requiredPattern) return true;
      return requiredPattern.test(`${track.title} ${track.artist} ${track.album || ''}`);
    });
  const hydrated = await hydrateCandidates(candidates, safeLimit);
  if (config.source !== 'auto' || hydrated.length >= safeLimit) return hydrated;

  const qqGroups = await Promise.all(
    queries.map((query) => qqMusic.search(config, query, 8).catch(() => []))
  );
  const qqCandidates = uniqueTracks(
    qqGroups.flat(),
    new Set([...excludeIds.map(String), ...hydrated.map((track) => track.id)])
  ).filter((track) => {
    if (!requiredPattern) return true;
    return requiredPattern.test(`${track.title} ${track.artist} ${track.album || ''}`);
  });
  const qqTracks = await hydrateCandidates(qqCandidates, safeLimit - hydrated.length);
  return [...hydrated, ...qqTracks].slice(0, safeLimit);
}

async function recentSongs(limit = 100) {
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 100));
  const { cookie } = await musicConfig();
  if (!cookie) return [];
  try {
    const data = directApi
      ? await callDirect('record_recent_song', { limit: safeLimit }, cookie)
      : await request(`/record/recent/song?limit=${safeLimit}`, cookie);
    return (data?.data?.list || [])
      .map((item) => normalizeSong(item.data || item.song || item))
      .filter((track) => track.id && track.title);
  } catch (error) {
    return [];
  }
}

async function songDetails(ids) {
  const normalizedIds = [...new Set(ids.map(String))]
    .filter((id) => /^\d{1,20}$/.test(id))
    .slice(0, 300);
  if (!normalizedIds.length) return [];
  const { cookie } = await musicConfig();
  try {
    const data = directApi
      ? await callDirect('song_detail', { ids: normalizedIds.join(',') }, cookie)
      : await request(`/song/detail?ids=${encodeURIComponent(normalizedIds.join(','))}`, cookie);
    return (data?.songs || []).map(normalizeSong);
  } catch (error) {
    return [];
  }
}

async function listeningHistory(localPlays = [], limit = 300) {
  const neteaseRecent = await recentSongs(limit);
  const details = await songDetails(localPlays.map((play) => play.song_id));
  const detailsById = new Map(details.map((track) => [track.id, track]));
  const localTracks = localPlays.map((play) => (
    detailsById.get(String(play.song_id)) || {
      id: String(play.song_id),
      provider: trackProvider(play.song_id),
      sourceId: qqMusic.sourceIdFromTrackId(play.song_id) || String(play.song_id),
      title: play.title || 'Unknown Track',
      artist: '',
      album: '',
      duration: 180,
      url: null,
      playCount: Number(play.play_count || 1),
      lastPlayed: play.last_played || ''
    }
  ));
  return uniqueTracks([...localTracks, ...neteaseRecent]).slice(0, limit);
}

async function artwork(id) {
  if (trackProvider(id) === 'qq') return qqMusic.artwork(await musicConfig(), id);
  if (trackProvider(id) !== 'netease') return null;
  return cached(`artwork:${id}`, 60 * 60 * 1000, async () => {
    const [track] = await songDetails([id]);
    if (!track?.coverUrl) return null;
    const url = new URL(track.coverUrl);
    if (!/^p\d+\.music\.126\.net$/.test(url.hostname)) return null;
    url.protocol = 'https:';
    url.search = '?param=800y800';
    return { id: track.id, album: track.album, source: url.href };
  });
}

function distributeRecommendationMix(discoveries, familiar, limit) {
  const total = Math.min(limit, discoveries.length + familiar.length);
  const queue = [];
  let discoveryIndex = 0;
  let familiarIndex = 0;

  for (let index = 0; index < total; index += 1) {
    const expectedFamiliar = Math.round(((index + 1) * familiar.length) / total);
    if (familiarIndex < expectedFamiliar && familiar[familiarIndex]) {
      queue.push(familiar[familiarIndex]);
      familiarIndex += 1;
    } else if (discoveries[discoveryIndex]) {
      queue.push(discoveries[discoveryIndex]);
      discoveryIndex += 1;
    } else if (familiar[familiarIndex]) {
      queue.push(familiar[familiarIndex]);
      familiarIndex += 1;
    }
  }
  return queue;
}

async function recommendationQueue(limit = 6, excludeIds = [], options = {}) {
  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 6));
  const excluded = new Set(excludeIds.map(String));
  const heard = new Set((options.heardIds || []).map(String));
  const requestedFamiliarTarget = Number(options.familiarTarget);
  const familiarTarget = Number.isFinite(requestedFamiliarTarget)
    ? Math.max(0, Math.min(safeLimit, Math.round(requestedFamiliarTarget)))
    : safeLimit >= 3 ? 1 : 0;
  const discoveryTarget = safeLimit - familiarTarget;
  const musicSettings = await musicConfig();
  const cookie = musicSettings.source === 'qq' ? '' : musicSettings.cookie;
  const allowedProvider = (track) =>
    musicSettings.source === 'auto' || trackProvider(track.id) === musicSettings.source;
  const currentId = String(options.currentId || '');
  const strictDiscoveryTracks = Boolean(options.strictDiscoveryTracks);

  const privateFmTask = cookie && !strictDiscoveryTracks
    ? (directApi
      ? callDirect('personal_fm', {}, cookie)
      : request('/personal_fm', cookie)).catch(() => null)
    : Promise.resolve(null);
  const dailyTask = cookie && !strictDiscoveryTracks
    ? (directApi
      ? callDirect('recommend_songs', {}, cookie)
      : request('/recommend/songs', cookie)).catch(() => null)
    : Promise.resolve(null);
  const similarTask = !strictDiscoveryTracks && /^\d{1,20}$/.test(currentId)
    ? (directApi
      ? callDirect('simi_song', { id: currentId, limit: 50 }, cookie)
      : request(`/simi/song?id=${encodeURIComponent(currentId)}&limit=50`, cookie)
    ).catch(() => null)
    : Promise.resolve(null);
  const newSongsTask = strictDiscoveryTracks
    ? Promise.resolve(null)
    : (directApi
      ? callDirect('personalized_newsong', { limit: 30 }, cookie)
      : request('/personalized/newsong?limit=30', cookie)
    ).catch(() => null);

  const [privateFm, daily, similar, newSongs] = await Promise.all([
    privateFmTask,
    dailyTask,
    similarTask,
    newSongsTask
  ]);
  const providerSeeds = interleaveTrackLists([
    (privateFm?.data || []).map(normalizeSong),
    (similar?.songs || []).map(normalizeSong),
    (daily?.data?.dailySongs || []).map(normalizeSong),
    (newSongs?.result || []).map((item) => normalizeSong(item.song || item))
  ]);
  const discoverySeeds = options.preferDiscoveryTracks
    ? [...(options.discoveryTracks || []), ...providerSeeds]
    : interleaveTrackLists([(options.discoveryTracks || []), providerSeeds]);
  const novelCandidates = uniqueTracks(discoverySeeds, excluded)
    .filter(allowedProvider)
    .filter((track) =>
      options.ignoreHeardForDiscovery || !heard.has(String(track.id))
    );
  const familiarCandidates = uniqueTracks(options.familiarTracks || [], excluded)
    .filter(allowedProvider)
    .filter((track) => heard.has(String(track.id)));

  const [discoveries, familiar] = await Promise.all([
    hydrateCandidates(novelCandidates, safeLimit),
    hydrateCandidates(familiarCandidates, safeLimit)
  ]);
  const selectedDiscoveries = discoveries.slice(0, discoveryTarget).map((track) => ({
    ...track,
    recommendationType: 'discovery'
  }));
  const selectedFamiliar = familiar.slice(0, familiarTarget).map((track) => ({
    ...track,
    recommendationType: 'familiar'
  }));
  const selectedIds = new Set(
    [...selectedDiscoveries, ...selectedFamiliar].map((track) => track.id)
  );
  const extras = [
    ...discoveries.map((track) => ({ ...track, recommendationType: 'discovery' })),
    ...familiar.map((track) => ({ ...track, recommendationType: 'familiar' }))
  ].filter((track) => !selectedIds.has(track.id));
  while (
    selectedDiscoveries.length + selectedFamiliar.length < safeLimit
    && extras.length
  ) {
    const track = extras.shift();
    selectedIds.add(track.id);
    if (track.recommendationType === 'familiar') selectedFamiliar.push(track);
    else selectedDiscoveries.push(track);
  }

  const queue = distributeRecommendationMix(
    selectedDiscoveries,
    selectedFamiliar,
    safeLimit
  );
  if (queue.length) return queue.slice(0, safeLimit);
  if (strictDiscoveryTracks) return [];
  const fallback = DEFAULT_TRACKS.filter((track) =>
    !excluded.has(track.id) && !heard.has(track.id)
  );
  return (fallback.length ? fallback : DEFAULT_TRACKS)
    .slice(0, safeLimit)
    .map((track) => ({ ...track, recommendationType: 'discovery' }));
}

async function resolve(query) {
  const normalizedQuery = String(query || '').trim();
  const provider = trackProvider(normalizedQuery);
  const isDirectId = isProviderTrackId(normalizedQuery);
  const config = await musicConfig();
  let candidates;
  if (
    (config.source === 'qq' && provider === 'netease')
    || (config.source === 'netease' && provider === 'qq')
  ) {
    candidates = [];
  } else if (provider === 'qq') {
    const track = await qqMusic.songDetails(config, normalizedQuery).catch(() => null);
    candidates = track ? [track] : [];
  } else if (provider === 'netease') {
    candidates = await songDetails([normalizedQuery]);
  } else {
    const providers = config.source === 'auto'
      ? ['netease', 'qq']
      : [config.source];
    for (const searchProvider of providers) {
      const providerCandidates = await (
        searchProvider === 'qq'
          ? qqMusic.search(config, normalizedQuery, 6)
          : searchNetease(normalizedQuery, 6)
      ).catch(() => []);
      for (const candidate of providerCandidates) {
        const source = await songSource(candidate.id);
        if (!source.url) continue;
        return {
          ...candidate,
          ...source,
          url: localAudioUrl(candidate.id, source.url)
        };
      }
    }
    candidates = [];
  }
  const fallbackCandidates = isDirectId && candidates[0]
    ? await search(`${candidates[0].title} ${candidates[0].artist}`, 6)
    : [];
  const seen = new Set();
  for (const candidate of [...candidates, ...fallbackCandidates]) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const source = await songSource(candidate.id);
    if (!source.url) continue;
    return {
      ...candidate,
      ...source,
      url: localAudioUrl(candidate.id, source.url)
    };
  }
  return null;
}

function normalizeAccountProfile(profile, account, quality) {
  if (!profile?.userId) return { loggedIn: false, quality };
  return {
    loggedIn: true,
    quality,
    profile: {
      userId: String(profile.userId),
      nickname: profile.nickname || '网易云用户',
      signature: profile.signature || '',
      vipType: Number(profile.vipType ?? account?.vipType ?? 0)
    }
  };
}

async function account() {
  const { cookie, quality } = await musicConfig();
  if (!cookie) return { loggedIn: false, quality };
  const timestamp = Date.now();
  const data = directApi
    ? await callDirect('login_status', { timestamp }, cookie)
    : await request(`/login/status?timestamp=${timestamp}`, cookie);
  return normalizeAccountProfile(data?.data?.profile || data?.profile, data?.data?.account, quality);
}

async function startQrLogin() {
  const timestamp = Date.now();
  const keyData = directApi
    ? await callDirect('login_qr_key', { timestamp })
    : await request(`/login/qr/key?timestamp=${timestamp}`);
  const key = keyData?.data?.unikey;
  if (!key) throw new Error('NetEase login key is unavailable');
  const qrData = directApi
    ? await callDirect('login_qr_create', { key, qrimg: true, timestamp: Date.now() })
    : await request(
      `/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&timestamp=${Date.now()}`
    );
  return {
    key,
    qrUrl: qrData?.data?.qrurl || '',
    qrImage: qrData?.data?.qrimg || ''
  };
}

async function checkQrLogin(key) {
  const data = directApi
    ? await callDirect('login_qr_check', { key, noCookie: true, timestamp: Date.now() })
    : await request(
      `/login/qr/check?key=${encodeURIComponent(key)}&noCookie=true&timestamp=${Date.now()}`
    );
  return {
    code: Number(data?.code || 0),
    message: data?.message || '',
    cookie: data?.code === 803 ? data.cookie || '' : ''
  };
}

async function userContext() {
  const config = await musicConfig();
  const session = await account();
  const sourceContext = {
    musicSource: config.source,
    qqMusicApiConfigured: Boolean(config.qqBaseUrl),
    qqMusicCookieConfigured: Boolean(config.qqCookie)
  };
  if (!session.loggedIn) return { ...session, ...sourceContext };
  const { cookie } = config;
  const uid = session.profile.userId;
  return cached(`user-context:${uid}:${session.quality}`, 5 * 60 * 1000, async () => {
    const calls = directApi
      ? [
        callDirect('recommend_songs', {}, cookie),
        callDirect('record_recent_song', { limit: 12 }, cookie),
        callDirect('likelist', { uid }, cookie),
        callDirect('user_playlist', { uid, limit: 12, offset: 0 }, cookie)
      ]
      : [
        request('/recommend/songs', cookie),
        request('/record/recent/song?limit=12', cookie),
        request(`/likelist?uid=${encodeURIComponent(uid)}`, cookie),
        request(`/user/playlist?uid=${encodeURIComponent(uid)}&limit=12&offset=0`, cookie)
      ];
    const [recommended, recent, liked, playlists] = await Promise.allSettled(calls);
    const value = (result) => result.status === 'fulfilled' ? result.value : {};
    return {
      ...session,
      ...sourceContext,
      likedSongCount: value(liked).ids?.length || 0,
      dailyRecommendations: (value(recommended).data?.dailySongs || [])
        .slice(0, 12)
        .map(normalizeSong),
      recentSongs: (value(recent).data?.list || [])
        .slice(0, 12)
        .map((item) => normalizeSong(item.data || item.song || item)),
      playlists: (value(playlists).playlist || [])
        .slice(0, 12)
        .map((playlist) => ({
          id: String(playlist.id),
          name: playlist.name,
          trackCount: Number(playlist.trackCount || 0),
          playCount: Number(playlist.playCount || 0)
        }))
    };
  });
}

async function resolveQueue(queries) {
  const candidates = await Promise.all(
    queries.slice(0, 6).map((query) => resolve(String(query)))
  );
  const resolved = candidates.filter(
    (track, index, all) => track && all.findIndex((item) => item?.id === track.id) === index
  );
  return resolved;
}

module.exports = {
  isConfigured: Boolean(directApi || API_BASE),
  mode: directApi ? 'netease-module+qqmusicapi' : API_BASE ? 'netease-http+qqmusicapi' : 'qqmusicapi',
  isProviderTrackId,
  trackProvider,
  search,
  songUrl,
  songSource,
  artwork,
  lyric,
  lyrics,
  comments,
  recommend,
  resolveSearchPool,
  recentSongs,
  listeningHistory,
  recommendationQueue,
  account,
  startQrLogin,
  checkQrLogin,
  userContext,
  resolve,
  resolveQueue,
  fallbackTracks: DEFAULT_TRACKS
};
