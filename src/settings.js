const state = require('./state');

const DEFAULT_AVATAR_URL = '/api/avatar/default';
const LEGACY_DEFAULT_AVATAR_URL = 'https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?prompt=realistic%20square%20portrait%20of%20a%20calm%20cat%20wearing%20tiny%20studio%20headphones%20as%20a%20late-night%20radio%20DJ%2C%20soft%20natural%20light%2C%20clean%20background%2C%20editorial%20photography%2C%20no%20text&image_size=square';
const CUSTOM_AVATAR_PATTERN = /^\/uploads\/avatar-[a-f0-9]{20}\.(?:jpg|png|webp)$/;
const DEFAULT_ASSISTANT_NAME = 'Forever';
const DEFAULT_GENRES = [
  'JAZZ',
  'HIP-HOP',
  'NEO-CLASSICAL',
  '90S 华语',
  'J-ROCK',
  '下雨白噪音',
  'POST-PUNK',
  'SHIBUYA-KEI'
];

const VOICES = [
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟 2.0', tone: '沉稳自然' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天 2.0', tone: '清朗温和' },
  { id: 'zh_male_liufei_uranus_bigtts', name: '刘飞 2.0', tone: '成熟松弛' },
  { id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰 2.0', tone: '儒雅叙事' },
  { id: 'zh_male_wennuanahu_uranus_bigtts', name: '温暖阿虎 2.0', tone: '温暖陪伴' },
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0', tone: '灵动自然' }
];

const AI_PROVIDERS = [
  {
    id: 'codex-cli',
    name: 'Codex CLI (ChatGPT)',
    baseUrl: '',
    model: '',
    authType: 'codex-cli'
  },
  {
    id: 'ark',
    name: 'Volcengine Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260915',
    authType: 'api-key'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    authType: 'api-key'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
    authType: 'api-key'
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    authType: 'optional-api-key'
  }
];

const VOICE_PROVIDERS = [
  {
    id: 'volcengine',
    name: 'Volcengine TTS',
    endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
  },
  {
    id: 'fish-audio',
    name: 'Fish Audio',
    endpoint: 'https://api.fish.audio/v1/tts'
  },
  {
    id: 'browser-speech',
    name: 'Browser Speech',
    endpoint: ''
  }
];

const MUSIC_QUALITIES = [
  { id: 'standard', name: '标准' },
  { id: 'higher', name: '较高' },
  { id: 'exhigh', name: '极高' },
  { id: 'lossless', name: '无损' },
  { id: 'hires', name: 'Hi-Res' },
  { id: 'jyeffect', name: '高清环绕声' },
  { id: 'sky', name: '沉浸环绕声' },
  { id: 'dolby', name: '杜比全景声' },
  { id: 'jymaster', name: '超清母带' }
];

const MUSIC_SOURCES = [
  { id: 'auto', name: '自动选择' },
  { id: 'netease', name: '仅网易云' },
  { id: 'qq', name: '仅 QQ 音乐' }
];

const QQ_MUSIC_QUALITIES = [
  { id: '128', name: 'MP3 128K' },
  { id: '320', name: 'MP3 320K' },
  { id: 'm4a', name: 'M4A' },
  { id: 'flac', name: 'FLAC 无损' }
];

const RESPONSE_MODES = [
  { id: 'direct', name: '直接播放' },
  { id: 'playlist', name: '歌单卡片' },
  { id: 'interactive', name: '互动选择' }
];

const DEFAULT_SETTINGS = {
  avatarUrl: DEFAULT_AVATAR_URL,
  assistantName: DEFAULT_ASSISTANT_NAME,
  genres: DEFAULT_GENRES,
  appearance: { playerStyle: 'classic' },
  recommendation: {
    familiarRate: 17,
    responseMode: 'direct'
  },
  voice: {
    speaker: process.env.VOLC_TTS_SPEAKER || VOICES[0].id,
    resourceId: process.env.VOLC_TTS_RESOURCE_ID || 'seed-tts-2.0',
    model: process.env.VOLC_TTS_MODEL || 'seed-tts-2.0-expressive',
    style: process.env.VOLC_TTS_STYLE
      || '像深夜电台主持人一样自然、松弛、克制地说话，语速稍慢，句间保留呼吸感。',
    emotion: process.env.VOLC_TTS_EMOTION || '',
    emotionScale: Number(process.env.VOLC_TTS_EMOTION_SCALE || 3),
    speechRate: Number(process.env.VOLC_TTS_SPEECH_RATE || -8),
    loudnessRate: Number(process.env.VOLC_TTS_LOUDNESS_RATE || 0)
  }
};

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function sanitizeVoice(input = {}, current = DEFAULT_SETTINGS.voice) {
  const allowedSpeakers = new Set(VOICES.map((voice) => voice.id));
  const customSpeaker = typeof input.speaker === 'string'
    && /^[A-Za-z][A-Za-z0-9_-]{7,255}$/.test(input.speaker);
  const allowedModels = new Set(['seed-tts-2.0-standard', 'seed-tts-2.0-expressive']);
  const allowedEmotions = new Set(['', 'happy', 'sad', 'angry', 'fear', 'surprised']);
  return {
    speaker: allowedSpeakers.has(input.speaker) || customSpeaker ? input.speaker : current.speaker,
    resourceId: input.resourceId === 'seed-icl-2.0' ? 'seed-icl-2.0' : 'seed-tts-2.0',
    model: allowedModels.has(input.model) ? input.model : current.model,
    style: typeof input.style === 'string'
      ? input.style.trim().slice(0, 300)
      : current.style,
    emotion: allowedEmotions.has(input.emotion) ? input.emotion : current.emotion,
    emotionScale: clamp(input.emotionScale, 1, 5, current.emotionScale),
    speechRate: clamp(input.speechRate, -50, 100, current.speechRate),
    loudnessRate: clamp(input.loudnessRate, -50, 100, current.loudnessRate)
  };
}

function sanitizeGenres(input, fallback = DEFAULT_GENRES) {
  if (!Array.isArray(input)) return [...fallback];
  const genres = [...new Set(
    input
      .map((genre) => String(genre).trim())
      .filter(Boolean)
      .map((genre) => genre.slice(0, 32))
  )].slice(0, 16);
  return genres.length ? genres : [...fallback];
}

function sanitizeAvatarUrl(value, fallback = DEFAULT_AVATAR_URL) {
  if (value === DEFAULT_AVATAR_URL || value === LEGACY_DEFAULT_AVATAR_URL) {
    return DEFAULT_AVATAR_URL;
  }
  return CUSTOM_AVATAR_PATTERN.test(value) ? value : fallback;
}

function sanitizeRecommendation(input = {}, current = DEFAULT_SETTINGS.recommendation) {
  return {
    familiarRate: Math.round(clamp(
      input.familiarRate,
      0,
      100,
      current.familiarRate
    )),
    responseMode: RESPONSE_MODES.some((mode) => mode.id === input.responseMode)
      ? input.responseMode
      : current.responseMode
  };
}

function findProvider(options, id) {
  return options.find((provider) => provider.id === id) || options[0];
}

function sanitizeUrl(value, fallback) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallback;
    return candidate.replace(/\/+$/, '').slice(0, 500);
  } catch (error) {
    return fallback;
  }
}

function sanitizeModel(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const model = value.trim().slice(0, 160);
  return model || fallback;
}

function sanitizeSecret(value, fallback = '') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().slice(0, 4096);
}

function environmentAiKey(provider) {
  if (provider === 'codex-cli') return '';
  if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  if (provider === 'openai-compatible') return process.env.LLM_API_KEY || '';
  return process.env.ARK_API_KEY || '';
}

function environmentVoiceKey(provider) {
  if (provider === 'fish-audio') return process.env.FISH_AUDIO_API_KEY || '';
  if (provider === 'volcengine') return process.env.VOLC_TTS_API_KEY || '';
  return '';
}

function defaultAiProvider() {
  if (process.env.CODEX_DEFAULT === '1') return 'codex-cli';
  if (process.env.OPENAI_API_KEY && !process.env.ARK_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY && !process.env.ARK_API_KEY) return 'anthropic';
  return 'ark';
}

function defaultVoiceProvider() {
  if (process.env.VOLC_TTS_API_KEY) return 'volcengine';
  if (process.env.FISH_AUDIO_API_KEY) return 'fish-audio';
  return 'browser-speech';
}

function sanitizeProviderSecrets(input, providers, legacyProvider, legacySecret) {
  const result = {};
  const source = input && typeof input === 'object' ? input : {};
  providers.forEach((provider) => {
    const secret = sanitizeSecret(source[provider.id]);
    if (secret) result[provider.id] = secret;
  });
  const migratedSecret = sanitizeSecret(legacySecret);
  if (migratedSecret && legacyProvider && !result[legacyProvider]) {
    result[legacyProvider] = migratedSecret;
  }
  return result;
}

async function getStoredIntegrations() {
  const stored = await state.getPref('service_integrations', {});
  const aiProvider = findProvider(AI_PROVIDERS, stored.ai?.provider || defaultAiProvider());
  const voiceProvider = findProvider(
    VOICE_PROVIDERS,
    stored.voice?.provider || defaultVoiceProvider()
  );
  const aiApiKeys = sanitizeProviderSecrets(
    stored.ai?.apiKeys,
    AI_PROVIDERS,
    stored.ai?.provider,
    stored.ai?.apiKey
  );
  const voiceApiKeys = sanitizeProviderSecrets(
    stored.voice?.apiKeys,
    VOICE_PROVIDERS,
    stored.voice?.provider,
    stored.voice?.apiKey
  );
  return {
    ai: {
      provider: aiProvider.id,
      baseUrl: sanitizeUrl(
        stored.ai?.baseUrl,
        process.env[`${aiProvider.id.toUpperCase()}_BASE_URL`] || aiProvider.baseUrl
      ),
      model: sanitizeModel(
        stored.ai?.model,
        aiProvider.id === 'codex-cli'
          ? process.env.CODEX_MODEL || aiProvider.model
          : aiProvider.id === 'ark'
          ? process.env.ARK_MODEL || aiProvider.model
          : aiProvider.id === 'openai'
            ? process.env.OPENAI_MODEL || aiProvider.model
            : aiProvider.id === 'anthropic'
              ? process.env.ANTHROPIC_MODEL || aiProvider.model
              : process.env.LLM_MODEL || aiProvider.model
      ),
      apiKeys: aiApiKeys,
      apiKey: aiApiKeys[aiProvider.id] || ''
    },
    voice: {
      provider: voiceProvider.id,
      endpoint: sanitizeUrl(
        stored.voice?.endpoint,
        voiceProvider.id === 'volcengine'
          ? process.env.VOLC_TTS_ENDPOINT || voiceProvider.endpoint
          : voiceProvider.id === 'fish-audio'
            ? process.env.FISH_AUDIO_ENDPOINT || voiceProvider.endpoint
            : ''
      ),
      voiceId: typeof stored.voice?.voiceId === 'string'
        ? stored.voice.voiceId.trim().slice(0, 255)
        : process.env.FISH_AUDIO_VOICE_ID || '',
      apiKeys: voiceApiKeys,
      apiKey: voiceApiKeys[voiceProvider.id] || ''
    },
    music: {
      source: MUSIC_SOURCES.some((source) => source.id === stored.music?.source)
        ? stored.music.source
        : MUSIC_SOURCES.some((source) => source.id === process.env.MUSIC_SOURCE)
          ? process.env.MUSIC_SOURCE
          : 'auto',
      cookie: typeof stored.music?.cookie === 'string' ? stored.music.cookie : '',
      quality: MUSIC_QUALITIES.some((quality) => quality.id === stored.music?.quality)
        ? stored.music.quality
        : MUSIC_QUALITIES.some((quality) => quality.id === process.env.NCM_QUALITY)
          ? process.env.NCM_QUALITY
          : 'exhigh',
      qqBaseUrl: sanitizeUrl(
        stored.music?.qqBaseUrl,
        process.env.QQ_MUSIC_API_BASE || 'http://127.0.0.1:3300'
      ),
      qqCookie: typeof stored.music?.qqCookie === 'string' ? stored.music.qqCookie : '',
      qqQuality: QQ_MUSIC_QUALITIES.some((quality) => quality.id === stored.music?.qqQuality)
        ? stored.music.qqQuality
        : QQ_MUSIC_QUALITIES.some((quality) => quality.id === process.env.QQ_MUSIC_QUALITY)
          ? process.env.QQ_MUSIC_QUALITY
          : '320'
    }
  };
}

async function getRuntimeIntegrations() {
  const stored = await getStoredIntegrations();
  return {
    ai: {
      ...stored.ai,
      apiKey: stored.ai.apiKey || environmentAiKey(stored.ai.provider)
    },
    voice: {
      ...stored.voice,
      apiKey: stored.voice.apiKey || environmentVoiceKey(stored.voice.provider)
    },
    music: {
      ...stored.music,
      cookie: stored.music.cookie || process.env.NETEASE_COOKIE || '',
      qqCookie: stored.music.qqCookie || process.env.QQ_MUSIC_COOKIE || ''
    }
  };
}

function maskSecret(secret) {
  if (!secret) return '';
  return secret.length > 4 ? `••••${secret.slice(-4)}` : '••••';
}

async function getPublicIntegrations() {
  const [stored, runtime] = await Promise.all([
    getStoredIntegrations(),
    getRuntimeIntegrations()
  ]);
  return {
    ai: {
      provider: stored.ai.provider,
      baseUrl: stored.ai.baseUrl,
      model: stored.ai.model,
      apiKeyConfigured: Boolean(runtime.ai.apiKey),
      apiKeyHint: maskSecret(runtime.ai.apiKey),
      apiKeySource: stored.ai.apiKey ? 'lab' : runtime.ai.apiKey ? 'environment' : 'none'
    },
    voice: {
      provider: stored.voice.provider,
      endpoint: stored.voice.endpoint,
      voiceId: stored.voice.voiceId,
      apiKeyConfigured: stored.voice.provider === 'browser-speech'
        || Boolean(runtime.voice.apiKey),
      apiKeyHint: maskSecret(runtime.voice.apiKey),
      apiKeySource: stored.voice.apiKey ? 'lab' : runtime.voice.apiKey ? 'environment' : 'none'
    },
    music: {
      source: stored.music.source,
      quality: stored.music.quality,
      cookieConfigured: Boolean(runtime.music.cookie),
      cookieSource: stored.music.cookie
        ? 'lab'
        : runtime.music.cookie ? 'environment' : 'none',
      qqBaseUrl: stored.music.qqBaseUrl,
      qqQuality: stored.music.qqQuality,
      qqCookieConfigured: Boolean(runtime.music.qqCookie),
      qqCookieHint: maskSecret(runtime.music.qqCookie),
      qqCookieSource: stored.music.qqCookie
        ? 'lab'
        : runtime.music.qqCookie ? 'environment' : 'none'
    },
    credentials: {
      ai: Object.fromEntries(AI_PROVIDERS.map((provider) => {
        const storedKey = stored.ai.apiKeys[provider.id] || '';
        const runtimeKey = storedKey || environmentAiKey(provider.id);
        return [provider.id, {
          apiKeyConfigured: Boolean(runtimeKey),
          apiKeyHint: maskSecret(runtimeKey),
          apiKeySource: storedKey ? 'lab' : runtimeKey ? 'environment' : 'none'
        }];
      })),
      voice: Object.fromEntries(VOICE_PROVIDERS.map((provider) => {
        const storedKey = stored.voice.apiKeys[provider.id] || '';
        const runtimeKey = storedKey || environmentVoiceKey(provider.id);
        return [provider.id, {
          apiKeyConfigured: provider.id === 'browser-speech' || Boolean(runtimeKey),
          apiKeyHint: maskSecret(runtimeKey),
          apiKeySource: storedKey ? 'lab' : runtimeKey ? 'environment' : 'none'
        }];
      }))
    },
    providerOptions: {
      ai: AI_PROVIDERS,
      voice: VOICE_PROVIDERS,
      musicSources: MUSIC_SOURCES,
      musicQualities: MUSIC_QUALITIES,
      qqMusicQualities: QQ_MUSIC_QUALITIES
    }
  };
}

async function updateIntegrations(input = {}) {
  const current = await getStoredIntegrations();
  const aiProvider = findProvider(AI_PROVIDERS, input.ai?.provider || current.ai.provider);
  const voiceProvider = findProvider(
    VOICE_PROVIDERS,
    input.voice?.provider || current.voice.provider
  );
  const aiApiKeys = { ...current.ai.apiKeys };
  const voiceApiKeys = { ...current.voice.apiKeys };
  const requestedAiKey = sanitizeSecret(input.ai?.apiKey);
  const requestedVoiceKey = sanitizeSecret(input.voice?.apiKey);
  if (requestedAiKey) aiApiKeys[aiProvider.id] = requestedAiKey;
  if (requestedVoiceKey) voiceApiKeys[voiceProvider.id] = requestedVoiceKey;
  const next = {
    ai: {
      provider: aiProvider.id,
      baseUrl: sanitizeUrl(input.ai?.baseUrl, aiProvider.baseUrl),
      model: sanitizeModel(input.ai?.model, aiProvider.model),
      apiKeys: aiApiKeys,
      apiKey: aiApiKeys[aiProvider.id] || ''
    },
    voice: {
      provider: voiceProvider.id,
      endpoint: voiceProvider.id === 'browser-speech'
        ? ''
        : sanitizeUrl(input.voice?.endpoint, voiceProvider.endpoint),
      voiceId: typeof input.voice?.voiceId === 'string'
        ? input.voice.voiceId.trim().slice(0, 255)
        : current.voice.voiceId,
      apiKeys: voiceApiKeys,
      apiKey: voiceApiKeys[voiceProvider.id] || ''
    },
    music: {
      source: MUSIC_SOURCES.some((source) => source.id === input.music?.source)
        ? input.music.source
        : current.music.source,
      cookie: sanitizeSecret(input.music?.cookie, current.music.cookie),
      quality: MUSIC_QUALITIES.some((quality) => quality.id === input.music?.quality)
        ? input.music.quality
        : current.music.quality,
      qqBaseUrl: sanitizeUrl(input.music?.qqBaseUrl, current.music.qqBaseUrl),
      qqCookie: sanitizeSecret(input.music?.qqCookie, current.music.qqCookie),
      qqQuality: QQ_MUSIC_QUALITIES.some((quality) => quality.id === input.music?.qqQuality)
        ? input.music.qqQuality
        : current.music.qqQuality
    }
  };
  await state.setPref('service_integrations', next);
  return getPublicIntegrations();
}

async function clearIntegrationKey(target) {
  const current = await getStoredIntegrations();
  if (!['ai', 'voice', 'music', 'qq-music'].includes(target)) {
    throw new Error('Unknown integration target');
  }
  if (target === 'music') current.music.cookie = '';
  else if (target === 'qq-music') current.music.qqCookie = '';
  else {
    delete current[target].apiKeys[current[target].provider];
    current[target].apiKey = '';
  }
  await state.setPref('service_integrations', current);
  return getPublicIntegrations();
}

async function restoreEnvironmentKeys() {
  const current = await getStoredIntegrations();
  AI_PROVIDERS.forEach((provider) => {
    const secret = environmentAiKey(provider.id);
    if (secret && !current.ai.apiKeys[provider.id]) current.ai.apiKeys[provider.id] = secret;
  });
  VOICE_PROVIDERS.forEach((provider) => {
    const secret = environmentVoiceKey(provider.id);
    if (secret && !current.voice.apiKeys[provider.id]) current.voice.apiKeys[provider.id] = secret;
  });
  current.ai.apiKey = current.ai.apiKeys[current.ai.provider] || '';
  current.voice.apiKey = current.voice.apiKeys[current.voice.provider] || '';
  await state.setPref('service_integrations', current);
  return getPublicIntegrations();
}

async function updateMusicCookie(cookie) {
  const current = await getStoredIntegrations();
  current.music.cookie = sanitizeSecret(cookie);
  await state.setPref('service_integrations', current);
  return getPublicIntegrations();
}

async function updateQqMusicCookie(cookie) {
  const current = await getStoredIntegrations();
  current.music.qqCookie = sanitizeSecret(cookie);
  await state.setPref('service_integrations', current);
  return getPublicIntegrations();
}

async function getSettings() {
  const stored = await state.getPref('debug_settings', {});
  return {
    avatarUrl: sanitizeAvatarUrl(stored.avatarUrl),
    assistantName: typeof stored.assistantName === 'string' && stored.assistantName.trim()
      && !/^(swagger(?: ai radio)?|claudio)$/i.test(stored.assistantName.trim())
      ? stored.assistantName.trim().slice(0, 32)
      : DEFAULT_SETTINGS.assistantName,
    genres: sanitizeGenres(stored.genres, DEFAULT_SETTINGS.genres),
    appearance: {
      playerStyle: ['album', 'glass'].includes(stored.appearance?.playerStyle)
        ? stored.appearance.playerStyle : 'classic'
    },
    recommendation: sanitizeRecommendation(
      stored.recommendation,
      DEFAULT_SETTINGS.recommendation
    ),
    voice: sanitizeVoice(stored.voice, DEFAULT_SETTINGS.voice)
  };
}

async function updateSettings(input = {}) {
  const current = await getSettings();
  const avatarUrl = sanitizeAvatarUrl(input.avatarUrl, current.avatarUrl);
  const next = {
    avatarUrl,
    appearance: {
      playerStyle: ['classic', 'album', 'glass'].includes(input.appearance?.playerStyle)
        ? input.appearance.playerStyle
        : current.appearance.playerStyle
    },
    assistantName: typeof input.assistantName === 'string' && input.assistantName.trim()
      ? input.assistantName.trim().slice(0, 32)
      : current.assistantName,
    genres: input.genres === undefined
      ? current.genres
      : sanitizeGenres(input.genres, current.genres),
    recommendation: sanitizeRecommendation(
      input.recommendation || {},
      current.recommendation
    ),
    voice: sanitizeVoice(input.voice || {}, current.voice)
  };
  await state.setPref('debug_settings', next);
  return next;
}

async function resetAvatar() {
  const current = await getSettings();
  return updateSettings({ ...current, avatarUrl: DEFAULT_AVATAR_URL });
}

module.exports = {
  DEFAULT_AVATAR_URL,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_GENRES,
  DEFAULT_SETTINGS,
  AI_PROVIDERS,
  MUSIC_QUALITIES,
  MUSIC_SOURCES,
  QQ_MUSIC_QUALITIES,
  RESPONSE_MODES,
  VOICE_PROVIDERS,
  VOICES,
  clearIntegrationKey,
  getPublicIntegrations,
  getRuntimeIntegrations,
  updateIntegrations,
  restoreEnvironmentKeys,
  updateMusicCookie,
  updateQqMusicCookie,
  sanitizeGenres,
  sanitizeRecommendation,
  sanitizeVoice,
  getSettings,
  updateSettings,
  resetAvatar
};
