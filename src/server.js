const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const defaultDataRoot = path.resolve(
  process.env.SWAGGER_DATA_DIR || path.join(__dirname, '..')
);
require('dotenv').config({
  path: process.env.SWAGGER_ENV_FILE || path.join(defaultDataRoot, '.env'),
  quiet: true
});

const express = require('express');
const http = require('http');
const { Readable } = require('stream');
const WebSocket = require('ws');
const cors = require('cors');

const router = require('./router');
const claude = require('./claude');
const codex = require('./codex');
const desktopActions = require('./desktop-actions');
const llm = require('./llm');
const scheduler = require('./scheduler');
const music = require('./music');
const tts = require('./tts');
const state = require('./state');
const settings = require('./settings');
const paths = require('./paths');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/stream' });
const TASTE_PATH = path.join(paths.USER_DIR, 'taste.md');

// #region debug-point B-C:audio-proxy
const AUDIO_DEBUG_ENDPOINT = process.env.DEBUG_SERVER_URL || 'http://127.0.0.1:7777/event';
function reportAudioDebug(hypothesisId, location, msg, data, traceId) {
  fetch(AUDIO_DEBUG_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'desktop-audio-truncation',
      runId: 'post-fix',
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      traceId,
      ts: Date.now()
    })
  }).catch(() => {});
}
// #endregion

const station = {
  current: music.fallbackTracks[0],
  queue: music.fallbackTracks.slice(1),
  playing: false,
  updatedAt: new Date().toISOString()
};

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static(paths.PUBLIC_DIR));
app.use('/uploads', express.static(paths.UPLOADS_DIR, {
  immutable: true,
  maxAge: '30d'
}));
app.use('/tts', express.static(paths.TTS_CACHE_DIR, {
  immutable: true,
  maxAge: '7d'
}));

function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

function hasValidImageSignature(buffer, contentType) {
  if (contentType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/webp') {
    return buffer.subarray(0, 4).toString() === 'RIFF'
      && buffer.subarray(8, 12).toString() === 'WEBP';
  }
  return false;
}

async function readTaste() {
  try {
    return await fs.readFile(TASTE_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '# My Taste\n';
    throw error;
  }
}

async function writeTaste(markdown) {
  const temporaryPath = `${TASTE_PATH}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(TASTE_PATH), { recursive: true });
  await fs.writeFile(temporaryPath, markdown, 'utf8');
  await fs.rename(temporaryPath, TASTE_PATH);
}

function isTrackId(value) {
  return music.isProviderTrackId(value);
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch (error) {
    // Invalid origins are rejected below.
  }
  return res.status(403).json({ error: 'Cross-origin settings changes are not allowed' });
}

async function publicIntegrations() {
  const integrations = await settings.getPublicIntegrations();
  return {
    ...integrations,
    codex: codex.status()
  };
}

function setQueue(queue) {
  if (!Array.isArray(queue) || !queue.length) return;
  station.current = queue[0];
  station.queue = queue.slice(1);
  station.updatedAt = new Date().toISOString();
  broadcast('now-playing', station.current);
  broadcast('queue', station.queue);
}

function playerContext() {
  return {
    playing: station.playing,
    current: station.current
      ? {
        id: station.current.id,
        title: station.current.title,
        artist: station.current.artist,
        quality: station.current.quality || ''
      }
      : null,
    queue: station.queue.slice(0, 6).map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist
    }))
  };
}

function autoplayDirectiveStatus(directive) {
  return {
    active: Boolean(directive),
    strategy: directive ? 'directive-ai-first' : 'balanced',
    remainingMinutes: directive
      ? Math.max(0, Math.ceil((Date.parse(directive.expiresAt) - Date.now()) / 60000))
      : 0,
    directive
  };
}

async function bootstrapStation() {
  try {
    const queue = await music.resolveQueue([
      'Bread If',
      'Nujabes Aruarian Dance',
      'Chet Baker Time After Time',
      'Tycho A Walk'
    ]);
    if (queue.length) {
      station.current = queue[0];
      station.queue = queue.slice(1);
      station.updatedAt = new Date().toISOString();
      station.current.lyric = await music.lyric(station.current.id);
    }
  } catch (error) {
    console.warn(`[music] ${error.message}; using bundled fallback queue`);
  }
}

app.get('/api/health', async (req, res) => {
  const [aiStatus, voiceProvider] = await Promise.all([
    llm.status(),
    tts.provider()
  ]);
  res.json({
    ok: true,
    services: {
      ai: aiStatus,
      claude: process.env.CLAUDE_DISABLED === '1'
        ? 'disabled'
        : claude.isAvailable ? 'cli' : 'local-fallback',
      music: music.mode,
      tts: voiceProvider,
      weather: process.env.OPENWEATHER_API_KEY ? 'configured' : 'not-configured',
      calendar: process.env.CALENDAR_CONTEXT_URL ? 'configured' : 'not-configured'
    }
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 500) {
      return res.status(400).json({ error: 'text must be 500 characters or fewer' });
    }

    const routed = await router.routeIntent(text, { player: playerContext() });
    const data = routed.type === 'chat' ? routed.data : routed;
    if (Array.isArray(data.queue) && data.queue.length) setQueue(data.queue);

    let speech = { url: null, provider: 'browser-speech' };
    if (data.say) {
      try {
        const currentSettings = await settings.getSettings();
        speech = await tts.synthesize(data.say, currentSettings.voice);
      } catch (error) {
        speech = { url: null, provider: 'browser-speech', error: 'tts_unavailable' };
      }
    }
    res.json({ ...data, speech });
  } catch (error) {
    console.error('[chat]', error);
    res.status(500).json({ error: 'Forever could not process this request' });
  }
});

app.get('/api/now', (req, res) => {
  res.json({
    current: station.current,
    playing: station.playing,
    updatedAt: station.updatedAt
  });
});

app.get('/api/next', (req, res) => {
  res.json({ next: station.queue });
});

app.post('/api/queue/continue', async (req, res) => {
  try {
    const excludeIds = Array.isArray(req.body?.excludeIds)
      ? req.body.excludeIds.map(String).filter((id) => id.length <= 40).slice(-300)
      : [];
    const current = req.body?.current && typeof req.body.current === 'object'
      ? {
        id: String(req.body.current.id || '').slice(0, 40),
        title: String(req.body.current.title || '').slice(0, 200),
        artist: String(req.body.current.artist || '').slice(0, 200),
        quality: String(req.body.current.quality || '').slice(0, 24)
      }
      : playerContext().current;
    const continuation = await router.continueQueue({
      excludeIds,
      player: {
        ...playerContext(),
        current
      }
    });
    res.json(continuation);
  } catch (error) {
    console.error('[queue-continue]', error);
    res.status(502).json({ error: 'A continuation queue could not be prepared' });
  }
});

app.get('/api/autoplay/directive', async (req, res) => {
  const directive = await router.getActiveAutoplayDirective();
  res.json(autoplayDirectiveStatus(directive));
});

app.put('/api/autoplay/directive', requireSameOrigin, async (req, res) => {
  try {
    const instruction = typeof req.body?.instruction === 'string'
      ? req.body.instruction.trim()
      : '';
    const durationMinutes = Number(req.body?.durationMinutes);
    if (!instruction || instruction.length > 500) {
      return res.status(400).json({ error: 'instruction must contain 1 to 500 characters' });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
      return res.status(400).json({ error: 'durationMinutes must be between 15 and 1440' });
    }
    const directive = await router.setAutoplayDirective(instruction, durationMinutes);
    const status = autoplayDirectiveStatus(directive);
    broadcast('autoplay-directive', status);
    return res.json(status);
  } catch (error) {
    console.error('[autoplay-directive]', error);
    return res.status(400).json({ error: 'Autoplay directive could not be saved' });
  }
});

app.delete('/api/autoplay/directive', requireSameOrigin, async (req, res) => {
  await router.clearAutoplayDirective();
  const status = autoplayDirectiveStatus(null);
  broadcast('autoplay-directive', status);
  res.json(status);
});

app.post('/api/history/play', requireSameOrigin, async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim().slice(0, 40);
    const title = String(req.body?.title || '').trim().slice(0, 200);
    if (!id || !title) return res.status(400).json({ error: 'id and title are required' });
    await state.recordPlay(id, title);
    return res.json({ recorded: true });
  } catch (error) {
    console.error('[play-history]', error);
    return res.status(500).json({ error: 'Play history could not be saved' });
  }
});

app.post('/api/track/intro', async (req, res) => {
  try {
    const track = req.body?.track && typeof req.body.track === 'object'
      ? {
        id: String(req.body.track.id || '').slice(0, 40),
        title: String(req.body.track.title || '').slice(0, 200),
        artist: String(req.body.track.artist || '').slice(0, 200),
        album: String(req.body.track.album || '').slice(0, 200)
      }
      : null;
    if (!track?.title) return res.status(400).json({ error: 'track is required' });
    const intro = await router.introduceTrack(track, { player: playerContext() });
    let speech = { url: null, provider: 'browser-speech' };
    if (intro.say) {
      try {
        const currentSettings = await settings.getSettings();
        speech = await tts.synthesize(intro.say, currentSettings.voice);
      } catch (error) {
        speech = { url: null, provider: 'browser-speech', error: 'tts_unavailable' };
      }
    }
    res.json({ ...intro, speech });
  } catch (error) {
    console.error('[track-intro]', error);
    res.status(502).json({ error: 'Track introduction is unavailable' });
  }
});

app.get('/api/taste', async (req, res) => {
  res.type('text/markdown').send(await readTaste());
});

app.get('/api/profile', async (req, res) => {
  const [current, taste] = await Promise.all([
    settings.getSettings(),
    readTaste()
  ]);
  res.json({ genres: current.genres, taste });
});

app.put('/api/profile', async (req, res) => {
  try {
    const genres = req.body?.genres;
    const taste = req.body?.taste;
    if (!Array.isArray(genres) || genres.length < 1 || genres.length > 16) {
      return res.status(400).json({ error: 'genres must contain 1 to 16 items' });
    }
    if (genres.some((genre) => typeof genre !== 'string' || genre.trim().length > 32)) {
      return res.status(400).json({ error: 'each genre must be 32 characters or fewer' });
    }
    if (typeof taste !== 'string' || taste.length > 8000) {
      return res.status(400).json({ error: 'taste must be 8000 characters or fewer' });
    }
    const normalizedTaste = taste.replace(/\0/g, '').trim();
    await writeTaste(normalizedTaste ? `${normalizedTaste}\n` : '');
    const updated = await settings.updateSettings({ genres });
    const profile = { genres: updated.genres, taste: await readTaste() };
    broadcast('settings', updated);
    broadcast('profile', profile);
    return res.json(profile);
  } catch (error) {
    console.error('[profile]', error);
    return res.status(500).json({ error: 'Profile could not be saved' });
  }
});

app.get('/api/track/:id/audio', async (req, res) => {
  if (!isTrackId(req.params.id)) {
    return res.status(400).json({ error: 'A valid track id is required' });
  }
  const traceId = `${req.params.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  // #region debug-point B:audio-request
  reportAudioDebug('B', 'src/server.js:audio-request', 'audio proxy request', {
    trackId: req.params.id,
    range: req.get('range') || null,
    userAgent: req.get('user-agent') || ''
  }, traceId);
  // #endregion
  try {
    const headers = {
      'User-Agent': req.get('user-agent') || 'Mozilla/5.0',
      Referer: music.trackProvider(req.params.id) === 'qq'
        ? 'https://y.qq.com/'
        : 'https://music.163.com/',
      'Accept-Encoding': 'identity'
    };
    if (req.get('range')) headers.Range = req.get('range');

    let source = await music.songSource(req.params.id);
    if (!source.url) return res.status(404).json({ error: 'Audio source is unavailable' });
    let upstream = await fetch(source.url, { headers });
    if (!upstream.ok) {
      source = await music.songSource(req.params.id, { force: true });
      if (!source.url) return res.status(404).json({ error: 'Audio source is unavailable' });
      upstream = await fetch(source.url, { headers });
    }
    // #region debug-point B-C:upstream-response
    reportAudioDebug('B-C', 'src/server.js:upstream-response', 'audio upstream response', {
      trackId: req.params.id,
      status: upstream.status,
      requestedRange: headers.Range || null,
      contentLength: upstream.headers.get('content-length'),
      contentRange: upstream.headers.get('content-range'),
      acceptRanges: upstream.headers.get('accept-ranges'),
      contentType: upstream.headers.get('content-type'),
      sourceHost: (() => {
        try {
          return new URL(source.url).host;
        } catch (error) {
          return '';
        }
      })()
    }, traceId);
    // #endregion
    if (!upstream.ok) {
      return res.status(502).json({ error: `Audio upstream returned ${upstream.status}` });
    }

    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) res.set(name, value);
    });
    res.set('Cache-Control', 'no-store');
    res.status(upstream.status);
    if (!upstream.body) return res.end();
    const stream = Readable.fromWeb(upstream.body);
    let streamedBytes = 0;
    // #region debug-point B-C:stream-lifecycle
    stream.on('data', (chunk) => {
      streamedBytes += chunk.length;
    });
    stream.on('end', () => reportAudioDebug(
      'B-C',
      'src/server.js:audio-stream-end',
      'audio upstream stream ended',
      {
        trackId: req.params.id,
        streamedBytes,
        contentLength: upstream.headers.get('content-length'),
        contentRange: upstream.headers.get('content-range')
      },
      traceId
    ));
    stream.on('error', (error) => reportAudioDebug(
      'C',
      'src/server.js:audio-stream-error',
      'audio upstream stream failed',
      { trackId: req.params.id, streamedBytes, error: error.message },
      traceId
    ));
    res.on('close', () => reportAudioDebug(
      'B',
      'src/server.js:audio-response-close',
      'audio client response closed',
      {
        trackId: req.params.id,
        streamedBytes,
        writableEnded: res.writableEnded,
        destroyed: res.destroyed
      },
      traceId
    ));
    // #endregion
    return stream.pipe(res);
  } catch (error) {
    console.error('[audio-proxy]', error);
    if (!res.headersSent) return res.status(502).json({ error: 'Audio stream is unavailable' });
    return res.destroy(error);
  }
});

app.get('/api/track/:id/lyrics', async (req, res) => {
  if (!isTrackId(req.params.id)) {
    return res.status(400).json({ error: 'A valid track id is required' });
  }
  try {
    const lines = await music.lyrics(req.params.id);
    return res.json({ trackId: req.params.id, lines });
  } catch (error) {
    console.error('[lyrics]', error);
    return res.status(502).json({ error: 'Lyrics are unavailable' });
  }
});

app.get('/api/track/:id/comments', async (req, res) => {
  if (!isTrackId(req.params.id)) {
    return res.status(400).json({ error: 'A valid track id is required' });
  }
  try {
    const comments = await music.comments(req.params.id, req.query.limit);
    return res.json({ trackId: req.params.id, ...comments });
  } catch (error) {
    console.error('[comments]', error);
    return res.status(502).json({ error: 'Comments are unavailable' });
  }
});

app.get(['/api/avatar', '/api/avatar/default'], async (req, res) => {
  // Serve bytes locally: a redirect to an external image fails offline and can
  // leave old installations pointing to a missing upload.
  res.set('Cache-Control', 'no-store');
  if (req.path !== '/api/avatar/default') {
    const current = await settings.getSettings();
    const match = /^\/uploads\/(avatar-[a-f0-9]{20}\.(jpg|png|webp))$/.exec(current.avatarUrl);
    if (match) {
      try {
        const bytes = await fs.readFile(path.join(paths.UPLOADS_DIR, match[1]));
        const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[match[2]];
        if (bytes.length <= 3 * 1024 * 1024 && hasValidImageSignature(bytes, type)) {
          return res.type(type).send(bytes);
        }
      } catch (error) {
        // Preserve the stored selection; use the bundled avatar if it is missing.
      }
    }
  }
  const bytes = await fs.readFile(paths.DEFAULT_AVATAR_PATH);
  return res.type('image/png').send(bytes);
});

app.get('/api/track/:id/artwork', async (req, res) => {
  if (!isTrackId(req.params.id)) return res.status(400).json({ error: 'Invalid track id' });
  try {
    const artwork = await music.artwork(req.params.id);
    res.json({
      id: req.params.id,
      album: artwork?.album || '',
      coverUrl: artwork ? `/api/track/${encodeURIComponent(req.params.id)}/cover` : null
    });
  } catch (error) {
    res.status(502).json({ error: 'Artwork is unavailable' });
  }
});

app.get('/api/track/:id/cover', async (req, res) => {
  if (!isTrackId(req.params.id)) return res.sendStatus(400);
  try {
    const artwork = await music.artwork(req.params.id);
    if (!artwork) return res.sendStatus(404);
    const response = await fetch(artwork.source, {
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
      headers: {
        Referer: artwork.provider === 'qq'
          ? 'https://y.qq.com/'
          : 'https://music.163.com/'
      }
    });
    const type = (response.headers.get('content-type') || '').replace('image/jpg', 'image/jpeg');
    if (!response.ok || !/^image\/(jpeg|png|webp)(;|$)/i.test(type)) return res.sendStatus(502);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) return res.sendStatus(502);
    res.set('Cache-Control', 'public, max-age=86400').type(type).send(bytes);
  } catch (error) {
    res.sendStatus(502);
  }
});

app.get('/api/settings', async (req, res) => {
  const current = await settings.getSettings();
  res.json({
    ...current,
    defaultAvatarUrl: settings.DEFAULT_AVATAR_URL,
    voiceOptions: settings.VOICES,
    provider: await tts.provider(current.voice)
  });
});

app.put('/api/settings', async (req, res) => {
  try {
    const updated = await settings.updateSettings(req.body);
    broadcast('settings', updated);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: 'Settings could not be saved' });
  }
});

app.get('/api/integrations', async (req, res) => {
  res.json(await publicIntegrations());
});

app.put('/api/integrations', requireSameOrigin, async (req, res) => {
  try {
    await settings.updateIntegrations(req.body);
    const updated = await publicIntegrations();
    broadcast('integrations', updated);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: 'Service connections could not be saved' });
  }
});

app.delete('/api/integrations/:target/key', requireSameOrigin, async (req, res) => {
  try {
    await settings.clearIntegrationKey(req.params.target);
    const updated = await publicIntegrations();
    broadcast('integrations', updated);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: 'Credential could not be cleared' });
  }
});

app.get('/api/integrations/codex/status', async (req, res) => {
  res.json(codex.status(true));
});

app.post('/api/integrations/codex/login', requireSameOrigin, async (req, res) => {
  try {
    const status = await codex.login();
    const integrations = await publicIntegrations();
    broadcast('integrations', integrations);
    res.json({ status, integrations });
  } catch (error) {
    const statusCode = error.code === 'CODEX_NOT_INSTALLED' ? 503 : 400;
    res.status(statusCode).json({
      error: error.message || 'Codex CLI login could not be completed',
      code: error.code || 'CODEX_LOGIN_FAILED',
      status: codex.status(true)
    });
  }
});

app.get('/api/music/account', async (req, res) => {
  try {
    res.json(await music.account());
  } catch (error) {
    console.error('[music-account]', error);
    res.status(502).json({ error: 'NetEase account status is unavailable' });
  }
});

app.post('/api/music/login/qr', requireSameOrigin, async (req, res) => {
  try {
    res.json(await music.startQrLogin());
  } catch (error) {
    console.error('[music-login]', error);
    res.status(502).json({ error: 'NetEase QR login could not be started' });
  }
});

app.get('/api/music/login/qr/:key', requireSameOrigin, async (req, res) => {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(req.params.key)) {
    return res.status(400).json({ error: 'Invalid login key' });
  }
  try {
    const result = await music.checkQrLogin(req.params.key);
    if (result.code === 803 && result.cookie) {
      await settings.updateMusicCookie(result.cookie);
      const integrations = await publicIntegrations();
      broadcast('integrations', integrations);
      return res.json({ code: result.code, message: result.message, account: await music.account() });
    }
    return res.json({ code: result.code, message: result.message });
  } catch (error) {
    console.error('[music-login-check]', error);
    return res.status(502).json({ error: 'NetEase login status could not be checked' });
  }
});

app.delete('/api/music/login', requireSameOrigin, async (req, res) => {
  try {
    await settings.clearIntegrationKey('music');
    const integrations = await publicIntegrations();
    broadcast('integrations', integrations);
    res.json({ integrations, account: await music.account() });
  } catch (error) {
    res.status(400).json({ error: 'NetEase session could not be cleared' });
  }
});

app.get('/api/music/qq/login/status', async (req, res) => {
  const integrations = await settings.getPublicIntegrations();
  res.json({
    ...desktopActions.getQqMusicLoginStatus(),
    cookieConfigured: integrations.music.qqCookieConfigured
  });
});

app.post('/api/music/qq/login', requireSameOrigin, async (req, res) => {
  try {
    const status = await desktopActions.startQqMusicLogin(async (cookie) => {
      await settings.updateQqMusicCookie(cookie);
      broadcast('integrations', await publicIntegrations());
    });
    res.status(status.available ? 202 : 501).json(status);
  } catch (error) {
    res.status(500).json({ error: 'QQ Music login could not be started' });
  }
});

app.delete('/api/music/qq/login', requireSameOrigin, async (req, res) => {
  try {
    await settings.clearIntegrationKey('qq-music');
    const integrations = await publicIntegrations();
    broadcast('integrations', integrations);
    res.json({ integrations, status: desktopActions.getQqMusicLoginStatus() });
  } catch (error) {
    res.status(400).json({ error: 'QQ Music session could not be cleared' });
  }
});

app.post(
  '/api/settings/avatar',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }),
  async (req, res) => {
    const extensionByType = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    };
    const extension = extensionByType[req.headers['content-type']];
    if (
      !extension
      || !Buffer.isBuffer(req.body)
      || !req.body.length
      || !hasValidImageSignature(req.body, req.headers['content-type'])
    ) {
      return res.status(400).json({ error: 'A JPEG, PNG or WebP image is required' });
    }
    const hash = crypto.createHash('sha256').update(req.body).digest('hex').slice(0, 20);
    const filename = `avatar-${hash}.${extension}`;
    const directory = paths.UPLOADS_DIR;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, filename), req.body);
    const updated = await settings.updateSettings({ avatarUrl: `/uploads/${filename}` });
    broadcast('settings', updated);
    res.json({ avatarUrl: updated.avatarUrl });
  }
);

app.post('/api/settings/avatar/reset', async (req, res) => {
  const updated = await settings.resetAvatar();
  broadcast('settings', updated);
  res.json({ avatarUrl: updated.avatarUrl });
});

app.post('/api/voice/preview', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 500) {
      return res.status(400).json({ error: 'text must be 500 characters or fewer' });
    }
    const current = await settings.getSettings();
    const voice = settings.sanitizeVoice(req.body?.voice || {}, current.voice);
    res.json(await tts.synthesize(text, voice));
  } catch (error) {
    console.error('[voice]', error);
    res.status(502).json({ error: 'Voice synthesis is unavailable' });
  }
});

app.get('/api/plan/today', async (req, res) => {
  const saved = await state.getLatestPlan();
  res.json({ plan: saved || scheduler.schedule });
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'station-state',
    data: {
      ...station,
      connectedAt: new Date().toISOString()
    }
  }));

  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'player-state') {
        station.playing = Boolean(message.data?.playing);
        station.updatedAt = new Date().toISOString();
        broadcast('player-state', { playing: station.playing });
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', data: { code: 'invalid_message' } }));
    }
  });
});

let stopScheduler = null;
let startPromise = null;

function startScheduler() {
  if (stopScheduler) return;
  stopScheduler = scheduler.initScheduler(async (entry) => {
    const result = await router.routeIntent(entry.prompt, { player: playerContext() });
    const data = result.type === 'chat' ? result.data : result;
    if (Array.isArray(data.queue) && data.queue.length) setQueue(data.queue);
    await state.savePlan({
      generatedAt: new Date().toISOString(),
      trigger: entry,
      queue: data.queue || []
    });
    broadcast('schedule', { entry, say: data.say || '' });
  });
}

function stopSchedulerIfRunning() {
  if (!stopScheduler) return;
  stopScheduler();
  stopScheduler = null;
}

server.on('close', stopSchedulerIfRunning);

async function startServer(options = {}) {
  if (server.listening) {
    const address = server.address();
    const port = typeof address === 'object' ? address.port : Number(options.port || 8080);
    return { server, port, url: `http://127.0.0.1:${port}` };
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    await paths.ensureDataLayout();
    await bootstrapStation();
    startScheduler();

    const port = Number(options.port ?? process.env.PORT ?? 8080);
    const host = options.host ?? process.env.HOST ?? '';
    await new Promise((resolve, reject) => {
      const handleError = (error) => {
        server.off('listening', handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off('error', handleError);
        resolve();
      };
      server.once('error', handleError);
      server.once('listening', handleListening);
      if (host) server.listen(port, host);
      else server.listen(port);
    });

    const address = server.address();
    const actualPort = typeof address === 'object' ? address.port : port;
    const url = `http://127.0.0.1:${actualPort}`;
    console.log(`Forever is running on ${url}`);
    return { server, port: actualPort, url };
  })().catch((error) => {
    stopSchedulerIfRunning();
    startPromise = null;
    throw error;
  });

  return startPromise;
}

async function stopServer() {
  stopSchedulerIfRunning();
  wss.clients.forEach((client) => client.close());
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  startPromise = null;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[startup]', error);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  server,
  startServer,
  stopServer
};
