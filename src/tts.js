const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const settings = require('./settings');
const { TTS_CACHE_DIR } = require('./paths');

const CACHE_DIR = TTS_CACHE_DIR;

// #region debug-point D:voice-provider
const VOICE_DEBUG_ENDPOINT = process.env.DEBUG_SERVER_URL || 'http://127.0.0.1:7778/event';
function reportVoiceDebug(location, msg, data = {}) {
  fetch(VOICE_DEBUG_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'desktop-ark-connection',
      runId: 'post-fix',
      hypothesisId: 'D',
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}
// #endregion

function resolveProvider(options, integration) {
  if (
    integration.provider === 'volcengine'
    && integration.apiKey
    && (options.speaker || process.env.VOLC_TTS_SPEAKER)
  ) {
    return 'volcengine';
  }
  if (integration.provider === 'fish-audio' && integration.apiKey) return 'fish-audio';
  return 'browser-speech';
}

async function provider(options = null) {
  const { voice } = await settings.getRuntimeIntegrations();
  const voiceOptions = options || (await settings.getSettings()).voice;
  return resolveProvider(voiceOptions, voice);
}

function cacheKey(text, voice) {
  return crypto
    .createHash('sha256')
    .update(`${voice}:${text}`)
    .digest('hex')
    .slice(0, 24);
}

async function readCache(filename) {
  try {
    await fs.access(path.join(CACHE_DIR, filename));
    return { url: `/tts/${filename}`, cached: true };
  } catch (error) {
    return null;
  }
}

async function writeCache(filename, audio) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, filename), audio);
  return `/tts/${filename}`;
}

function parseVolcChunks(raw) {
  const audio = [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^data:\s*/, '').trim())
    .filter(Boolean);

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      continue;
    }
    if (event.code && ![0, 20000000].includes(event.code)) {
      throw new Error(event.message || `Volcengine TTS returned code ${event.code}`);
    }
    if (event.data) audio.push(Buffer.from(event.data, 'base64'));
  }

  if (!audio.length) throw new Error('Volcengine TTS returned no audio data');
  return Buffer.concat(audio);
}

async function synthesizeWithVolc(text, options, integration) {
  const speaker = options.speaker || process.env.VOLC_TTS_SPEAKER;
  const resourceId = options.resourceId || process.env.VOLC_TTS_RESOURCE_ID || 'seed-tts-2.0';
  const model = options.model || process.env.VOLC_TTS_MODEL || 'seed-tts-2.0-expressive';
  const style = options.style || process.env.VOLC_TTS_STYLE
    || '像深夜电台主持人一样自然、松弛、克制地说话，语速稍慢，句间保留呼吸感。';
  const speechRate = Number(options.speechRate ?? process.env.VOLC_TTS_SPEECH_RATE ?? -8);
  const loudnessRate = Number(options.loudnessRate ?? process.env.VOLC_TTS_LOUDNESS_RATE ?? 0);
  const emotion = options.emotion ?? process.env.VOLC_TTS_EMOTION ?? '';
  const emotionScale = Number(options.emotionScale ?? process.env.VOLC_TTS_EMOTION_SCALE ?? 3);
  const signature = JSON.stringify({
    resourceId, speaker, model, style, speechRate, loudnessRate, emotion, emotionScale
  });
  const filename = `${cacheKey(text, signature)}.mp3`;
  const cached = await readCache(filename);
  if (cached) return { ...cached, provider: 'volcengine', speaker };

  const additions = {
    context_texts: [style],
    section_id: process.env.VOLC_TTS_SECTION_ID || crypto.randomUUID(),
    cache_config: { text_type: 1, use_cache: true }
  };

  const response = await fetch(integration.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': integration.apiKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': crypto.randomUUID()
    },
    body: JSON.stringify({
      user: { uid: process.env.VOLC_TTS_USER_ID || 'claudio-local' },
      req_params: {
        text,
        model,
        speaker,
        audio_params: {
          format: 'mp3',
          sample_rate: 24000,
          speech_rate: speechRate,
          loudness_rate: loudnessRate,
          emotion: emotion || undefined,
          emotion_scale: emotionScale
        },
        additions: JSON.stringify(additions)
      }
    })
  });

  const raw = await response.text();
  // #region debug-point D:voice-http-response
  const diagnosticEvent = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^data:\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .find((event) => event?.code || event?.message);
  reportVoiceDebug('src/tts.js:synthesizeWithVolc:response', 'voice provider responded', {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    bodyBytes: Buffer.byteLength(raw),
    providerCode: diagnosticEvent?.code ?? null,
    hasProviderMessage: Boolean(diagnosticEvent?.message)
  });
  // #endregion
  if (!response.ok) {
    throw new Error(`Volcengine TTS returned ${response.status}`);
  }
  const audio = parseVolcChunks(raw);
  return {
    url: await writeCache(filename, audio),
    provider: 'volcengine',
    speaker,
    cached: false
  };
}

async function synthesizeWithFish(text, integration) {
  const voiceId = integration.voiceId || process.env.FISH_AUDIO_VOICE_ID;
  const filename = `${cacheKey(text, voiceId || 'fish-default')}.mp3`;
  const cached = await readCache(filename);
  if (cached) return { ...cached, provider: 'fish-audio' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(integration.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${integration.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        reference_id: voiceId || undefined,
        format: 'mp3',
        normalize: true,
        latency: 'normal'
      })
    });
    if (!response.ok) throw new Error(`Fish Audio returned ${response.status}`);
    const audio = Buffer.from(await response.arrayBuffer());
    return {
      url: await writeCache(filename, audio),
      provider: 'fish-audio',
      cached: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesize(text, options = {}) {
  const { voice: integration } = await settings.getRuntimeIntegrations();
  const selected = resolveProvider(options, integration);
  // #region debug-point D:voice-runtime-config
  reportVoiceDebug('src/tts.js:synthesize:config', 'resolved voice configuration', {
    configuredProvider: integration.provider,
    selectedProvider: selected,
    endpointHost: (() => {
      try {
        return new URL(integration.endpoint).host;
      } catch (error) {
        return '';
      }
    })(),
    apiKeyConfigured: Boolean(integration.apiKey),
    apiKeyLength: integration.apiKey?.length || 0,
    hasSpeaker: Boolean(options.speaker || process.env.VOLC_TTS_SPEAKER)
  });
  // #endregion
  try {
    let result;
    if (selected === 'volcengine') {
      result = await synthesizeWithVolc(text, options, integration);
    } else if (selected === 'fish-audio') {
      result = await synthesizeWithFish(text, integration);
    } else {
      result = { url: null, provider: 'browser-speech', cached: false };
    }
    // #region debug-point D:voice-success
    reportVoiceDebug('src/tts.js:synthesize:success', 'voice synthesis succeeded', {
      provider: result.provider,
      hasAudioUrl: Boolean(result.url),
      cached: Boolean(result.cached)
    });
    // #endregion
    return result;
  } catch (error) {
    // #region debug-point D:voice-error
    reportVoiceDebug('src/tts.js:synthesize:error', 'voice synthesis failed', {
      provider: selected,
      name: error.name || null,
      code: error.code || null,
      message: String(error.message || '').slice(0, 300)
    });
    // #endregion
    throw error;
  }
}

module.exports = {
  synthesize,
  provider,
  isConfigured: async () => (await provider()) !== 'browser-speech'
};
