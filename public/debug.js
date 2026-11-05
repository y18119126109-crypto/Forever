const elements = {};
const state = {
  settings: null,
  profile: null,
  integrations: null,
  autoplayStrategy: null,
  musicAccount: null,
  musicLoginTimer: null,
  qqMusicLoginStatus: null,
  qqMusicLoginTimer: null,
  avatarUrl: '',
  avatarPreviewUrl: '',
  pendingAvatarFile: null,
  pendingAvatarReset: false,
  pendingKeyClears: new Set(),
  activePage: 'identity',
  loading: true
};

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  [
    'service-state', 'settings-form', 'avatar-preview', 'avatar-file', 'reset-avatar',
    'avatar-status', 'speaker-select', 'speaker-custom', 'voice-model', 'resource-id',
    'emotion', 'emotion-scale', 'emotion-scale-output', 'speech-rate',
    'speech-rate-output', 'loudness-rate', 'loudness-output', 'voice-style',
    'genre-tags', 'genre-preview', 'taste-markdown', 'preview-text',
    'preview-audio', 'preview-button', 'ai-provider', 'ai-base-url',
    'ai-model', 'ai-api-key', 'ai-key-status', 'clear-ai-key', 'voice-provider',
    'voice-endpoint', 'voice-service-id', 'voice-api-key', 'voice-key-status',
    'clear-voice-key', 'assistant-name', 'music-quality', 'music-account-indicator',
    'music-account-name', 'music-account-detail', 'music-login-button',
    'music-logout-button', 'music-qr', 'music-qr-image', 'music-login-status',
    'music-source', 'qq-music-base-url', 'qq-music-quality', 'qq-music-cookie',
    'qq-music-key-status', 'clear-qq-music-key',
    'qq-music-account', 'qq-music-account-name', 'qq-music-account-detail',
    'qq-music-login-button', 'qq-music-logout-button', 'qq-music-login-status',
    'identity-heading', 'voice-heading', 'lab-assistant-name', 'app-favicon', 'app-touch-icon',
    'familiar-rate', 'familiar-rate-output', 'familiar-meter',
    'familiar-track-count', 'discovery-track-count', 'identity-status',
    'profile-status', 'recommendation-status', 'integrations-status', 'voice-status',
    'directive-enabled', 'directive-instruction', 'directive-duration',
    'directive-strategy', 'directive-expiry', 'appearance-status',
    'codex-auth-actions', 'codex-login-button', 'codex-refresh-button',
    'codex-status-detail'
  ].forEach((id) => {
    elements[id] = $(id);
  });
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function setAvatar(avatarUrl) {
  if (state.avatarPreviewUrl) URL.revokeObjectURL(state.avatarPreviewUrl);
  state.avatarPreviewUrl = '';
  state.avatarUrl = avatarUrl;
  elements['avatar-preview'].src = `/api/avatar?v=${encodeURIComponent(avatarUrl)}`;
  elements['app-favicon'].href = '/assets/forever-icon-192.png';
  elements['app-touch-icon'].href = '/assets/forever-icon-512.png';
}

function setSectionStatus(page, text) {
  elements[`${page}-status`].textContent = text;
}

function markDirty(page, message = '有未保存的修改') {
  if (state.loading) return;
  setSectionStatus(page, message);
  document.querySelector(`[data-settings-page="${page}"]`)?.classList.add('dirty');
}

function markSaved(page, message = '已保存并同步') {
  setSectionStatus(page, message);
  document.querySelector(`[data-settings-page="${page}"]`)?.classList.remove('dirty');
}

function setActivePage(page, updateHash = true) {
  const panel = document.querySelector(`[data-settings-panel="${page}"]`);
  if (!panel) return;
  window.SwaggerGuide?.closeHelp();
  state.activePage = page;
  document.querySelectorAll('[data-settings-panel]').forEach((candidate) => {
    candidate.hidden = candidate !== panel;
  });
  document.querySelectorAll('[data-settings-page]').forEach((button) => {
    const active = button.dataset.settingsPage === page;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) button.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}#${page}`);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function voicePayload() {
  return {
    speaker: elements['speaker-custom'].value.trim() || elements['speaker-select'].value,
    model: elements['voice-model'].value,
    resourceId: elements['resource-id'].value,
    emotion: elements.emotion.value,
    emotionScale: Number(elements['emotion-scale'].value),
    speechRate: Number(elements['speech-rate'].value),
    loudnessRate: Number(elements['loudness-rate'].value),
    style: elements['voice-style'].value.trim()
  };
}

function genresPayload() {
  return [...new Set(
    elements['genre-tags'].value
      .split(/[,，\n]/)
      .map((genre) => genre.trim())
      .filter(Boolean)
  )];
}

function integrationsPayload() {
  return {
    ai: {
      provider: elements['ai-provider'].value,
      baseUrl: elements['ai-base-url'].value.trim(),
      model: elements['ai-model'].value.trim(),
      apiKey: elements['ai-api-key'].value.trim()
    },
    voice: {
      provider: elements['voice-provider'].value,
      endpoint: elements['voice-endpoint'].value.trim(),
      voiceId: elements['voice-service-id'].value.trim(),
      apiKey: elements['voice-api-key'].value.trim()
    },
    music: {
      source: elements['music-source'].value,
      quality: elements['music-quality'].value,
      cookie: '',
      qqBaseUrl: elements['qq-music-base-url'].value.trim(),
      qqQuality: elements['qq-music-quality'].value,
      qqCookie: elements['qq-music-cookie'].value.trim()
    }
  };
}

function renderGenrePreview() {
  elements['genre-preview'].replaceChildren(
    ...genresPayload().map((genre) => {
      const tag = document.createElement('span');
      tag.textContent = genre;
      return tag;
    })
  );
}

function renderProviderOptions(select, options) {
  select.replaceChildren(
    ...options.map((provider) => {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.name;
      return option;
    })
  );
}

function renderCodexStatus(config = {}) {
  const installed = Boolean(config.installed);
  const loggedIn = Boolean(config.loggedIn);
  const version = config.version || '';
  const authMode = config.authMode === 'chatgpt'
    ? 'ChatGPT'
    : config.authMode === 'api-key'
      ? 'API Key'
      : 'Codex';

  elements['codex-login-button'].disabled = !installed;
  elements['codex-login-button'].innerHTML = loggedIn
    ? '<i data-lucide="refresh-cw"></i>重新登录'
    : '<i data-lucide="log-in"></i>登录 Codex';

  if (!installed) {
    elements['codex-status-detail'].textContent =
      '未检测到 Codex CLI，请先执行 npm i -g @openai/codex';
  } else if (!loggedIn) {
    elements['codex-status-detail'].textContent =
      `${version || 'Codex CLI'} 已安装，等待 ChatGPT 登录`;
  } else {
    elements['codex-status-detail'].textContent =
      `${version || 'Codex CLI'} · ${authMode} 登录有效`;
  }
  refreshIcons();
}

function renderCredentialStatus(target, config) {
  const status = elements[`${target}-key-status`];
  const keyInput = elements[`${target}-api-key`];
  if (target === 'ai' && config.provider === 'codex-cli') {
    const cli = state.integrations?.codex || {};
    elements['codex-auth-actions'].hidden = false;
    keyInput.disabled = true;
    keyInput.placeholder = 'Codex CLI 登录无需 API Key';
    elements['clear-ai-key'].disabled = true;
    status.classList.toggle('configured', Boolean(cli.installed && cli.loggedIn));
    status.textContent = cli.installed && cli.loggedIn
      ? 'CLI · LOGGED IN'
      : cli.installed ? 'CLI · LOGIN REQUIRED' : 'CLI · NOT INSTALLED';
    renderCodexStatus(cli);
    return;
  }
  if (target === 'ai') {
    elements['codex-auth-actions'].hidden = true;
    keyInput.disabled = false;
  }
  if (target === 'voice' && config.provider === 'browser-speech') {
    status.classList.add('configured');
    status.textContent = 'LOCAL · NO KEY REQUIRED';
    keyInput.placeholder = '无需 API Key';
    elements['clear-voice-key'].disabled = true;
    return;
  }
  keyInput.placeholder = config.apiKeyConfigured
    ? `已配置 ${config.apiKeyHint}`
    : '输入 API Key';
  status.classList.toggle('configured', config.apiKeyConfigured);
  status.textContent = config.apiKeyConfigured
    ? `${config.apiKeySource.toUpperCase()} · ${config.apiKeyHint}`
    : 'NOT CONFIGURED';
  elements[`clear-${target}-key`].disabled = config.apiKeySource !== 'lab';
}

function updateAiIntegrationFields() {
  const codexCli = elements['ai-provider'].value === 'codex-cli';
  elements['ai-base-url'].disabled = codexCli;
  elements['ai-base-url'].placeholder = codexCli
    ? '由 Codex CLI 配置管理'
    : 'https://api.example.com/v1';
  elements['ai-model'].placeholder = codexCli
    ? '留空使用 Codex CLI 默认模型'
    : '模型 ID';
  elements['codex-auth-actions'].hidden = !codexCli;
}

function updateVoiceIntegrationFields() {
  const browserSpeech = elements['voice-provider'].value === 'browser-speech';
  [
    elements['voice-endpoint'],
    elements['voice-service-id'],
    elements['voice-api-key']
  ].forEach((field) => {
    field.disabled = browserSpeech;
  });
}

function renderIntegrations(payload) {
  state.integrations = payload;
  renderProviderOptions(elements['ai-provider'], payload.providerOptions.ai);
  renderProviderOptions(elements['voice-provider'], payload.providerOptions.voice);
  elements['ai-provider'].value = payload.ai.provider;
  elements['ai-base-url'].value = payload.ai.baseUrl;
  elements['ai-model'].value = payload.ai.model;
  elements['ai-api-key'].value = '';
  elements['ai-api-key'].placeholder = payload.ai.apiKeyConfigured
    ? `已配置 ${payload.ai.apiKeyHint}`
    : '输入 API Key';
  elements['voice-provider'].value = payload.voice.provider;
  elements['voice-endpoint'].value = payload.voice.endpoint;
  elements['voice-service-id'].value = payload.voice.voiceId;
  elements['voice-api-key'].value = '';
  elements['voice-api-key'].placeholder = payload.voice.apiKeyConfigured
    ? `已配置 ${payload.voice.apiKeyHint}`
    : '输入 API Key';
  renderProviderOptions(elements['music-quality'], payload.providerOptions.musicQualities);
  renderProviderOptions(elements['music-source'], payload.providerOptions.musicSources);
  renderProviderOptions(elements['qq-music-quality'], payload.providerOptions.qqMusicQualities);
  elements['music-source'].value = payload.music.source;
  elements['music-quality'].value = payload.music.quality;
  elements['qq-music-base-url'].value = payload.music.qqBaseUrl;
  elements['qq-music-quality'].value = payload.music.qqQuality;
  elements['qq-music-cookie'].value = '';
  elements['qq-music-cookie'].placeholder = payload.music.qqCookieConfigured
    ? `已配置 ${payload.music.qqCookieHint}`
    : '粘贴 QQ 音乐 Cookie';
  elements['qq-music-key-status'].classList.toggle(
    'configured',
    payload.music.qqCookieConfigured
  );
  elements['qq-music-key-status'].textContent = payload.music.qqCookieConfigured
    ? `${payload.music.qqCookieSource.toUpperCase()} · ${payload.music.qqCookieHint}`
    : 'OPTIONAL · NOT CONFIGURED';
  elements['clear-qq-music-key'].disabled = payload.music.qqCookieSource !== 'lab';
  updateAiIntegrationFields();
  renderCredentialStatus('ai', payload.ai);
  renderCredentialStatus('voice', payload.voice);
  updateVoiceIntegrationFields();
  if (state.qqMusicLoginStatus) {
    renderQqMusicLogin({
      ...state.qqMusicLoginStatus,
      cookieConfigured: payload.music.qqCookieConfigured
    });
  }
  window.SwaggerGuide?.refreshHelp();
}

function renderMusicAccount(account) {
  state.musicAccount = account;
  const container = elements['music-account-indicator'].closest('.music-account');
  container.classList.toggle('logged-in', Boolean(account?.loggedIn));
  elements['music-account-name'].textContent = account?.loggedIn
    ? account.profile.nickname
    : '未登录';
  elements['music-account-detail'].textContent = account?.loggedIn
    ? `UID ${account.profile.userId}${account.profile.vipType ? ' · VIP' : ''}`
    : 'LOCAL SESSION';
  elements['music-login-button'].innerHTML =
    `<i data-lucide="qr-code"></i>${account?.loggedIn ? '重新登录' : '扫码登录'}`;
  elements['music-logout-button'].disabled = !account?.loggedIn;
  refreshIcons();
}

function renderQqMusicLogin(status = {}) {
  state.qqMusicLoginStatus = status;
  const configured = Boolean(status.cookieConfigured);
  const active = Boolean(status.active);
  elements['qq-music-account'].classList.toggle('logged-in', configured);
  elements['qq-music-account'].classList.toggle('login-waiting', active);
  elements['qq-music-account-name'].textContent = configured
    ? '已登录'
    : active ? '等待扫码' : '未登录';
  elements['qq-music-account-detail'].textContent = status.available
    ? 'QQ MUSIC OFFICIAL SESSION'
    : '网页端请手动填写 COOKIE';
  elements['qq-music-login-button'].disabled = !status.available || active;
  elements['qq-music-login-button'].innerHTML = active
    ? '<i data-lucide="loader-circle"></i>等待扫码'
    : `<i data-lucide="qr-code"></i>${configured ? '重新登录' : '扫码登录'}`;
  elements['qq-music-logout-button'].disabled = !configured;
  elements['qq-music-login-status'].textContent = status.message || (
    status.available ? '扫码将在 QQ 音乐官方窗口中完成' : '桌面应用支持扫码登录'
  );
  refreshIcons();
}

function renderAssistantName(name) {
  elements['assistant-name'].value = name;
  elements['lab-assistant-name'].textContent = name;
  elements['identity-heading'].textContent = `${name} 的头像`;
  elements['voice-heading'].textContent = `${name} 的声音`;
  elements['avatar-preview'].alt = `${name} 当前头像`;
  document.title = `${name} Lab - 调试设置`;
}

function applyProviderDefaults(target) {
  const provider = elements[`${target}-provider`].value;
  const option = state.integrations?.providerOptions[target]
    ?.find((candidate) => candidate.id === provider);
  if (!option) return;
  const changedProvider = provider !== state.integrations?.[target]?.provider;
  if (target === 'ai') {
    elements['ai-base-url'].value = option.baseUrl;
    elements['ai-model'].value = option.model;
    updateAiIntegrationFields();
  } else {
    elements['voice-endpoint'].value = option.endpoint;
    updateVoiceIntegrationFields();
  }
  const keyInput = elements[`${target}-api-key`];
  if (changedProvider) {
    keyInput.value = '';
    const credential = state.integrations?.credentials?.[target]?.[provider] || {
      apiKeyConfigured: provider === 'browser-speech',
      apiKeyHint: '',
      apiKeySource: 'none'
    };
    renderCredentialStatus(target, { provider, ...credential });
  } else {
    renderCredentialStatus(target, state.integrations[target]);
  }
}

function setBusy(button, busy, idleLabel) {
  button.disabled = busy;
  button.dataset.idleLabel ||= idleLabel;
  const icon = busy ? 'loader-circle' : button.id === 'preview-button' ? 'volume-2' : 'save';
  button.innerHTML = `<i data-lucide="${icon}"></i>${busy ? '处理中...' : button.dataset.idleLabel}`;
  refreshIcons();
}

function bindRange(input, output) {
  const render = () => {
    output.value = input.value;
    output.textContent = input.value;
  };
  input.addEventListener('input', render);
  render();
}

function renderRecommendationMix() {
  const rate = Math.max(0, Math.min(100, Number(elements['familiar-rate'].value) || 0));
  const familiarCount = Math.round((6 * rate) / 100);
  elements['familiar-rate-output'].value = `${rate}%`;
  elements['familiar-rate-output'].textContent = `${rate}%`;
  elements['familiar-meter'].style.width = `${rate}%`;
  elements['familiar-track-count'].textContent = String(familiarCount);
  elements['discovery-track-count'].textContent = String(6 - familiarCount);
}

function updateDirectiveEditorState() {
  const enabled = elements['directive-enabled'].checked;
  elements['directive-instruction'].disabled = !enabled;
  elements['directive-duration'].disabled = !enabled;
}

function renderAutoplayStrategy(payload) {
  state.autoplayStrategy = payload;
  const directive = payload?.directive || null;
  elements['directive-enabled'].checked = Boolean(payload?.active);
  elements['directive-instruction'].value = directive?.instruction || '';
  elements['directive-duration'].value = directive?.durationMinutes || 120;
  elements['directive-strategy'].textContent = payload?.active
    ? '临时 AI 指令优先'
    : '通用混合推荐';
  if (payload?.active) {
    const expiresAt = new Date(directive.expiresAt);
    const time = Number.isNaN(expiresAt.getTime())
      ? ''
      : expiresAt.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    elements['directive-expiry'].textContent =
      `剩余 ${payload.remainingMinutes} 分钟${time ? ` · ${time} 到期` : ''}`;
  } else {
    elements['directive-expiry'].textContent = '长期生效';
  }
  updateDirectiveEditorState();
}

function renderSettings(
  payload,
  profile,
  integrations,
  musicAccount,
  qqMusicLoginStatus,
  autoplayStrategy
) {
  state.settings = payload;
  document.querySelectorAll('[name="player-style"]').forEach((input) => {
    input.checked = input.value === (payload.appearance?.playerStyle || 'classic');
  });
  document.querySelectorAll('[name="response-mode"]').forEach((input) => {
    input.checked = input.value === (payload.recommendation?.responseMode || 'direct');
  });
  state.profile = profile;
  state.pendingAvatarFile = null;
  state.pendingAvatarReset = false;
  state.pendingKeyClears.clear();
  setAvatar(payload.avatarUrl);
  renderAssistantName(payload.assistantName);
  elements['speaker-select'].replaceChildren(
    ...payload.voiceOptions.map((voice) => {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = `${voice.name} · ${voice.tone}`;
      return option;
    })
  );

  const knownSpeaker = payload.voiceOptions.some((voice) => voice.id === payload.voice.speaker);
  if (knownSpeaker) {
    elements['speaker-select'].value = payload.voice.speaker;
    elements['speaker-custom'].value = '';
  } else {
    elements['speaker-custom'].value = payload.voice.speaker;
  }
  elements['voice-model'].value = payload.voice.model;
  elements['resource-id'].value = payload.voice.resourceId;
  elements.emotion.value = payload.voice.emotion;
  elements['emotion-scale'].value = payload.voice.emotionScale;
  elements['speech-rate'].value = payload.voice.speechRate;
  elements['loudness-rate'].value = payload.voice.loudnessRate;
  elements['voice-style'].value = payload.voice.style;
  elements['familiar-rate'].value = payload.recommendation?.familiarRate ?? 17;
  elements['genre-tags'].value = (profile.genres || []).join(', ');
  elements['taste-markdown'].value = profile.taste || '';
  renderIntegrations(integrations);
  renderMusicAccount(musicAccount);
  renderQqMusicLogin({
    ...qqMusicLoginStatus,
    cookieConfigured: integrations.music.qqCookieConfigured
  });
  renderAutoplayStrategy(autoplayStrategy);
  renderGenrePreview();
  elements['emotion-scale'].dispatchEvent(new Event('input'));
  elements['speech-rate'].dispatchEvent(new Event('input'));
  elements['loudness-rate'].dispatchEvent(new Event('input'));
  renderRecommendationMix();
  ['identity', 'profile', 'recommendation', 'integrations', 'voice', 'appearance'].forEach((page) => {
    markSaved(page, '已同步');
  });
}

async function loadSettings() {
  const [
    settingsResponse,
    profileResponse,
    integrationsResponse,
    musicAccountResponse,
    qqMusicLoginStatusResponse,
    autoplayDirectiveResponse,
    healthResponse
  ] = await Promise.all([
    fetch('/api/settings'),
    fetch('/api/profile'),
    fetch('/api/integrations'),
    fetch('/api/music/account'),
    fetch('/api/music/qq/login/status'),
    fetch('/api/autoplay/directive'),
    fetch('/api/health')
  ]);
  if (
    !settingsResponse.ok
    || !profileResponse.ok
    || !integrationsResponse.ok
    || !musicAccountResponse.ok
    || !qqMusicLoginStatusResponse.ok
    || !autoplayDirectiveResponse.ok
  ) {
    throw new Error('设置读取失败');
  }
  const payload = await settingsResponse.json();
  const profile = await profileResponse.json();
  const integrations = await integrationsResponse.json();
  const musicAccount = await musicAccountResponse.json();
  const qqMusicLoginStatus = await qqMusicLoginStatusResponse.json();
  const autoplayStrategy = await autoplayDirectiveResponse.json();
  renderSettings(
    payload,
    profile,
    integrations,
    musicAccount,
    qqMusicLoginStatus,
    autoplayStrategy
  );

  const health = await healthResponse.json();
  const voiceProvider = health.services?.tts || payload.provider;
  const aiProvider = health.services?.ai?.provider || integrations.ai.provider;
  const ready = Boolean(health.services?.ai?.configured) || voiceProvider !== 'browser-speech';
  elements['service-state'].classList.toggle('ready', ready);
  elements['service-state'].lastChild.textContent =
    ` ${String(aiProvider).toUpperCase()} / ${String(voiceProvider).toUpperCase()}`;
}

function validateAvatar(file) {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(file.type)) throw new Error('仅支持 JPEG、PNG 或 WebP');
  if (file.size > 3 * 1024 * 1024) throw new Error('图片不能超过 3MB');
}

function stageAvatar(file) {
  validateAvatar(file);
  if (state.avatarPreviewUrl) URL.revokeObjectURL(state.avatarPreviewUrl);
  state.avatarPreviewUrl = URL.createObjectURL(file);
  state.pendingAvatarFile = file;
  state.pendingAvatarReset = false;
  elements['avatar-preview'].src = state.avatarPreviewUrl;
  elements['avatar-status'].textContent = '新头像待保存';
  markDirty('identity');
}

function stageAvatarReset() {
  if (state.avatarPreviewUrl) URL.revokeObjectURL(state.avatarPreviewUrl);
  state.avatarPreviewUrl = '';
  state.pendingAvatarFile = null;
  state.pendingAvatarReset = true;
  elements['avatar-preview'].src = state.settings.defaultAvatarUrl;
  elements['avatar-file'].value = '';
  elements['avatar-status'].textContent = '默认头像待保存';
  markDirty('identity');
}

async function uploadAvatar(file) {
  const response = await fetch('/api/settings/avatar', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '头像上传失败');
  return result.avatarUrl;
}

async function resetAvatar() {
  const response = await fetch('/api/settings/avatar/reset', { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '恢复失败');
  return result.avatarUrl;
}

async function updateDebugSettings(payload) {
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '设置保存失败');
  state.settings = { ...state.settings, ...result };
  return result;
}

async function saveSection(page, button, task) {
  setBusy(button, true, '保存并同步');
  setSectionStatus(page, '正在保存...');
  try {
    await task();
    markSaved(page);
  } catch (error) {
    setSectionStatus(page, error.message);
  } finally {
    setBusy(button, false, '保存并同步');
  }
}

async function saveIdentity() {
  let avatarUrl = state.avatarUrl;
  if (state.pendingAvatarFile) avatarUrl = await uploadAvatar(state.pendingAvatarFile);
  else if (state.pendingAvatarReset) avatarUrl = await resetAvatar();

  const result = await updateDebugSettings({
    avatarUrl,
    assistantName: elements['assistant-name'].value.trim()
  });
  setAvatar(result.avatarUrl);
  renderAssistantName(result.assistantName);
  state.pendingAvatarFile = null;
  state.pendingAvatarReset = false;
  elements['avatar-file'].value = '';
  elements['avatar-status'].textContent = '';
}

async function saveProfile() {
  const profileResponse = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      genres: genresPayload(),
      taste: elements['taste-markdown'].value
    })
  });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) throw new Error(profile.error || '档案保存失败');
  state.profile = profile;
}

async function saveRecommendation() {
  const enabled = elements['directive-enabled'].checked;
  const instruction = elements['directive-instruction'].value.trim();
  const durationMinutes = Number(elements['directive-duration'].value);
  if (enabled && !instruction) throw new Error('请填写临时推荐指令');
  if (enabled && (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440)) {
    throw new Error('持续时间需在 15 到 1440 分钟之间');
  }

  const [settingsResult, directiveResponse] = await Promise.all([
    updateDebugSettings({
      recommendation: {
        familiarRate: Number(elements['familiar-rate'].value),
        responseMode:
          document.querySelector('[name="response-mode"]:checked')?.value || 'direct'
      }
    }),
    fetch('/api/autoplay/directive', enabled
      ? {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, durationMinutes })
      }
      : { method: 'DELETE' })
  ]);
  const directiveResult = await directiveResponse.json();
  if (!directiveResponse.ok) {
    throw new Error(directiveResult.error || '推荐策略保存失败');
  }
  state.settings = { ...state.settings, ...settingsResult };
  renderAutoplayStrategy(directiveResult);
}

async function saveIntegrations() {
  const payload = integrationsPayload();
  for (const target of state.pendingKeyClears) {
    const clearResponse = await fetch(`/api/integrations/${target}/key`, {
      method: 'DELETE'
    });
    if (!clearResponse.ok) {
      const result = await clearResponse.json();
      throw new Error(result.error || 'Key 清除失败');
    }
  }
  const response = await fetch('/api/integrations', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '服务连接保存失败');
  state.pendingKeyClears.clear();
  renderIntegrations(result);
}

async function saveVoice() {
  await updateDebugSettings({ voice: voicePayload() });
}

async function saveAppearance() {
  const playerStyle = document.querySelector('[name="player-style"]:checked').value;
  await updateDebugSettings({ appearance: { playerStyle } });
}

function stopMusicLoginPolling() {
  window.clearTimeout(state.musicLoginTimer);
  state.musicLoginTimer = null;
}

function stopQqMusicLoginPolling() {
  window.clearTimeout(state.qqMusicLoginTimer);
  state.qqMusicLoginTimer = null;
}

async function pollQqMusicLogin() {
  try {
    const response = await fetch('/api/music/qq/login/status');
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || 'QQ 音乐登录状态读取失败');
    renderQqMusicLogin(status);
    if (status.status === 'success') {
      stopQqMusicLoginPolling();
      renderIntegrations(await fetch('/api/integrations').then((item) => item.json()));
      return;
    }
    if (!status.active) {
      stopQqMusicLoginPolling();
      return;
    }
    state.qqMusicLoginTimer = window.setTimeout(pollQqMusicLogin, 1200);
  } catch (error) {
    stopQqMusicLoginPolling();
    renderQqMusicLogin({
      ...state.qqMusicLoginStatus,
      active: false,
      status: 'error',
      message: error.message
    });
  }
}

async function startQqMusicLogin() {
  stopQqMusicLoginPolling();
  const response = await fetch('/api/music/qq/login', { method: 'POST' });
  const status = await response.json();
  renderQqMusicLogin({
    ...status,
    cookieConfigured: state.integrations?.music?.qqCookieConfigured
  });
  if (!response.ok) throw new Error(status.message || status.error || 'QQ 音乐扫码登录不可用');
  state.qqMusicLoginTimer = window.setTimeout(pollQqMusicLogin, 800);
}

async function logoutQqMusic() {
  stopQqMusicLoginPolling();
  const response = await fetch('/api/music/qq/login', { method: 'DELETE' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'QQ 音乐退出失败');
  renderIntegrations(result.integrations);
  renderQqMusicLogin({
    ...result.status,
    active: false,
    status: 'idle',
    message: '已退出 QQ 音乐',
    cookieConfigured: false
  });
}

async function pollMusicLogin(key) {
  try {
    const response = await fetch(`/api/music/login/qr/${encodeURIComponent(key)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '登录状态读取失败');
    elements['music-login-status'].textContent = result.message || '等待扫码';
    if (result.code === 803) {
      stopMusicLoginPolling();
      renderMusicAccount(result.account);
      renderIntegrations(await fetch('/api/integrations').then((item) => item.json()));
      elements['music-login-status'].textContent = '登录成功';
      elements['music-login-button'].disabled = false;
      return;
    }
    if (result.code === 800) {
      stopMusicLoginPolling();
      elements['music-login-button'].disabled = false;
      return;
    }
    state.musicLoginTimer = window.setTimeout(() => pollMusicLogin(key), 2000);
  } catch (error) {
    stopMusicLoginPolling();
    elements['music-login-button'].disabled = false;
    elements['music-login-status'].textContent = error.message;
  }
}

async function startMusicLogin() {
  stopMusicLoginPolling();
  elements['music-login-button'].disabled = true;
  elements['music-login-status'].textContent = '正在生成二维码...';
  const response = await fetch('/api/music/login/qr', { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '二维码创建失败');
  elements['music-qr-image'].src = result.qrImage;
  elements['music-qr'].hidden = false;
  elements['music-login-status'].textContent = '请使用网易云音乐扫码';
  state.musicLoginTimer = window.setTimeout(() => pollMusicLogin(result.key), 1500);
}

async function logoutMusic() {
  stopMusicLoginPolling();
  const response = await fetch('/api/music/login', { method: 'DELETE' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '退出失败');
  renderIntegrations(result.integrations);
  renderMusicAccount(result.account);
  elements['music-qr'].hidden = true;
}

function setCodexAuthBusy(busy, message = '') {
  elements['codex-login-button'].disabled = busy;
  elements['codex-refresh-button'].disabled = busy;
  if (busy) {
    elements['codex-login-button'].innerHTML =
      '<i data-lucide="loader-circle"></i>等待授权';
    elements['codex-status-detail'].textContent = message;
    refreshIcons();
  }
}

async function refreshCodexStatus() {
  setCodexAuthBusy(true, '正在检测 Codex CLI 与登录状态...');
  try {
    const response = await fetch('/api/integrations/codex/status');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Codex 状态检测失败');
    state.integrations.codex = result;
    renderCredentialStatus('ai', {
      provider: elements['ai-provider'].value
    });
  } catch (error) {
    setSectionStatus('integrations', error.message);
  } finally {
    setCodexAuthBusy(false);
    renderCodexStatus(state.integrations?.codex || {});
  }
}

async function startCodexLogin() {
  setCodexAuthBusy(true, '请在打开的浏览器中完成 ChatGPT 授权...');
  setSectionStatus('integrations', '正在等待 Codex CLI 登录...');
  try {
    const response = await fetch('/api/integrations/codex/login', { method: 'POST' });
    const result = await response.json();
    if (result.status) state.integrations.codex = result.status;
    if (!response.ok) throw new Error(result.error || 'Codex CLI 登录失败');
    renderCredentialStatus('ai', {
      provider: elements['ai-provider'].value
    });
    setSectionStatus('integrations', 'Codex CLI 登录成功，保存后启用');
  } catch (error) {
    renderCredentialStatus('ai', {
      provider: elements['ai-provider'].value
    });
    setSectionStatus('integrations', error.message);
  } finally {
    setCodexAuthBusy(false);
    renderCodexStatus(state.integrations?.codex || {});
  }
}

async function previewVoice() {
  const text = elements['preview-text'].value.trim();
  if (!text) {
    setSectionStatus('voice', '请先输入试听文本');
    return;
  }

  setBusy(elements['preview-button'], true, '生成试听');
  setSectionStatus('voice', '正在生成云端语音...');
  try {
    const response = await fetch('/api/voice/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voicePayload() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '试听生成失败');
    if (!result.url) throw new Error('当前没有可用的云端 TTS');
    elements['preview-audio'].src = `${result.url}?t=${Date.now()}`;
    await elements['preview-audio'].play();
    setSectionStatus('voice', `${result.provider} · ${result.cached ? '缓存命中' : '新生成'}`);
  } catch (error) {
    setSectionStatus('voice', error.message);
  } finally {
    setBusy(elements['preview-button'], false, '生成试听');
  }
}

function stageIntegrationKeyClear(target) {
  state.pendingKeyClears.add(target);
  elements[`${target}-api-key`].value = '';
  elements[`${target}-key-status`].classList.remove('configured');
  elements[`${target}-key-status`].textContent = '待保存后清除';
  markDirty('integrations');
}

function stageQqMusicCookieClear() {
  state.pendingKeyClears.add('qq-music');
  elements['qq-music-cookie'].value = '';
  elements['qq-music-key-status'].classList.remove('configured');
  elements['qq-music-key-status'].textContent = '待保存后清除';
  markDirty('integrations');
}

function bindEvents() {
  const pages = [...document.querySelectorAll('[data-settings-page]')];
  pages.forEach((button, index) => {
    button.addEventListener('click', () => setActivePage(button.dataset.settingsPage));
    button.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % pages.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + pages.length) % pages.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = pages.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      pages[nextIndex].focus();
      setActivePage(pages[nextIndex].dataset.settingsPage);
    });
  });

  bindRange(elements['emotion-scale'], elements['emotion-scale-output']);
  bindRange(elements['speech-rate'], elements['speech-rate-output']);
  bindRange(elements['loudness-rate'], elements['loudness-output']);
  elements['familiar-rate'].addEventListener('input', renderRecommendationMix);
  elements['directive-enabled'].addEventListener('change', updateDirectiveEditorState);
  elements['genre-tags'].addEventListener('input', renderGenrePreview);
  elements['ai-provider'].addEventListener('change', () => applyProviderDefaults('ai'));
  elements['voice-provider'].addEventListener('change', () => applyProviderDefaults('voice'));
  elements['codex-login-button'].addEventListener('click', startCodexLogin);
  elements['codex-refresh-button'].addEventListener('click', refreshCodexStatus);
  elements['music-login-button'].addEventListener('click', async () => {
    try {
      await startMusicLogin();
    } catch (error) {
      elements['music-login-button'].disabled = false;
      elements['music-login-status'].textContent = error.message;
      elements['music-qr'].hidden = false;
    }
  });
  elements['music-logout-button'].addEventListener('click', async () => {
    try {
      await logoutMusic();
      markSaved('integrations', '网易云账号已退出');
    } catch (error) {
      setSectionStatus('integrations', error.message);
    }
  });
  elements['qq-music-login-button'].addEventListener('click', async () => {
    try {
      await startQqMusicLogin();
    } catch (error) {
      setSectionStatus('integrations', error.message);
    }
  });
  elements['qq-music-logout-button'].addEventListener('click', async () => {
    try {
      await logoutQqMusic();
      markSaved('integrations', 'QQ 音乐账号已退出');
    } catch (error) {
      setSectionStatus('integrations', error.message);
    }
  });
  elements['clear-ai-key'].addEventListener('click', () => {
    stageIntegrationKeyClear('ai');
  });
  elements['clear-voice-key'].addEventListener('click', () => {
    stageIntegrationKeyClear('voice');
  });
  elements['clear-qq-music-key'].addEventListener('click', stageQqMusicCookieClear);
  ['ai', 'voice'].forEach((target) => {
    elements[`${target}-api-key`].addEventListener('input', () => {
      if (elements[`${target}-api-key`].value.trim()) {
        state.pendingKeyClears.delete(target);
      }
    });
  });
  elements['qq-music-cookie'].addEventListener('input', () => {
    if (elements['qq-music-cookie'].value.trim()) {
      state.pendingKeyClears.delete('qq-music');
    }
  });

  elements['speaker-select'].addEventListener('change', () => {
    elements['speaker-custom'].value = '';
  });
  elements['speaker-custom'].addEventListener('input', () => {
    if (elements['speaker-custom'].value.trim()) {
      elements['resource-id'].value = 'seed-icl-2.0';
    }
  });
  elements['avatar-file'].addEventListener('change', () => {
    const [file] = elements['avatar-file'].files;
    if (!file) return;
    try {
      stageAvatar(file);
    } catch (error) {
      elements['avatar-status'].textContent = error.message;
    }
  });
  elements['reset-avatar'].addEventListener('click', stageAvatarReset);
  elements['preview-button'].addEventListener('click', previewVoice);
  const sectionSavers = {
    identity: saveIdentity,
    profile: saveProfile,
    recommendation: saveRecommendation,
    integrations: saveIntegrations,
    voice: saveVoice,
    appearance: saveAppearance
  };
  document.querySelectorAll('[data-save-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.saveSection;
      saveSection(page, button, sectionSavers[page]);
    });
  });
  document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    panel.querySelectorAll('input:not([type="file"]):not([data-transient]), select, textarea:not([data-transient])')
      .forEach((field) => {
        field.addEventListener('input', () => markDirty(panel.dataset.settingsPanel));
        field.addEventListener('change', () => markDirty(panel.dataset.settingsPanel));
      });
  });
  elements['settings-form'].addEventListener('submit', (event) => event.preventDefault());
  window.addEventListener('hashchange', () => {
    setActivePage(location.hash.slice(1) || 'identity', false);
  });
}

async function init() {
  cacheElements();
  bindEvents();
  setActivePage(location.hash.slice(1) || 'identity', false);
  refreshIcons();
  try {
    await loadSettings();
    state.loading = false;
  } catch (error) {
    elements['service-state'].lastChild.textContent = ' OFFLINE';
    setSectionStatus(state.activePage, error.message);
    state.loading = false;
  }
  window.SwaggerGuide?.initLab({
    setPage: setActivePage,
    getPage: () => state.activePage
  });
}

document.addEventListener('DOMContentLoaded', init);
