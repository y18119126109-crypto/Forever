const fallbackTracks = [
  { id: 'bread-if', title: 'If', artist: 'Bread', duration: 158, tones: [146.83, 185, 220] },
  { id: 'night-window', title: '凌晨两点的窗', artist: 'Mellow Fields', duration: 194, tones: [130.81, 164.81, 196] },
  { id: 'cold-coffee', title: '咖啡冷却之前', artist: 'Sunday Archive', duration: 208, tones: [164.81, 207.65, 246.94] },
  { id: 'neon-return', title: '霓虹返航', artist: 'Northbound', duration: 236, tones: [110, 146.83, 185] }
];

const DEFAULT_AVATAR_URL = '/api/avatar';
const DEFAULT_ASSISTANT_NAME = 'Forever';
const DEFAULT_GENRES = [
  'JAZZ', 'HIP-HOP', 'NEO-CLASSICAL', '90S 华语',
  'J-ROCK', '下雨白噪音', 'POST-PUNK', 'SHIBUYA-KEI'
];

const state = {
  theme: localStorage.getItem('claudio-theme') || 'dark',
  tracks: [...fallbackTracks],
  currentIndex: 0,
  elapsed: 0,
  playing: false,
  favoriteOnly: false,
  favorites: new Set(),
  timer: null,
  audioContext: null,
  mediaDestination: null,
  masterGain: null,
  oscillators: [],
  ws: null,
  avatarUrl: DEFAULT_AVATAR_URL,
  assistantName: DEFAULT_ASSISTANT_NAME,
  genres: [...DEFAULT_GENRES],
  stageMode: 'time',
  lyricsByTrack: new Map(),
  commentsByTrack: new Map(),
  activeLyricIndex: -1,
  stageRequestToken: 0,
  playerPinned: localStorage.getItem('claudio-player-pinned') !== 'false',
  chatFocus: false,
  recognition: null,
  voiceTranscript: '',
  voiceAutoSubmit: false,
  voiceHoldTimer: null,
  voiceHoldActive: false,
  voiceStopPending: false,
  continuationPromise: null,
  advancingTrack: false,
  audioMode: 'music',
  resumeAfterSpeech: false,
  speechToken: 0,
  speechText: '',
  musicErrorRetryCount: 0,
  handlingAudioError: false,
  introCache: new Map(),
  introInflight: new Map(),
  introducedTrackIds: new Set(),
  lastRecordedTrackId: null,
  autoplayDirective: null,
  connected: false,
  connectionKnown: false,
  greetingContextKey: '',
  currentGreeting: '',
  previousPageGreeting: localStorage.getItem('swagger-last-greeting') || '',
  responseMode: 'direct',
  responseArtifacts: new Map(),
  responseArtifactSequence: 0
};

const elements = {};

// #region debug-point A-D-E:audio-client
const AUDIO_DEBUG_ENDPOINT = 'http://127.0.0.1:7777/event';
function audioDebugSnapshot(extra = {}) {
  const audio = elements.audio;
  const buffered = [];
  if (audio?.buffered) {
    for (let index = 0; index < audio.buffered.length; index += 1) {
      buffered.push([audio.buffered.start(index), audio.buffered.end(index)]);
    }
  }
  return {
    platform: navigator.userAgent.includes('Electron') ? 'electron' : 'web',
    userAgent: navigator.userAgent,
    trackId: currentTrack()?.id || null,
    trackTitle: currentTrack()?.title || '',
    trackDuration: currentTrack()?.duration || null,
    currentIndex: state.currentIndex,
    playing: state.playing,
    audioMode: state.audioMode,
    source: audio?.dataset.source || '',
    currentSrc: audio?.currentSrc || '',
    currentTime: Number.isFinite(audio?.currentTime) ? audio.currentTime : null,
    mediaDuration: Number.isFinite(audio?.duration) ? audio.duration : null,
    readyState: audio?.readyState ?? null,
    networkState: audio?.networkState ?? null,
    buffered,
    mediaError: audio?.error
      ? { code: audio.error.code, message: audio.error.message || '' }
      : null,
    ...extra
  };
}

function reportAudioDebug(hypothesisId, location, msg, data = {}) {
  fetch(AUDIO_DEBUG_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'desktop-audio-truncation',
      runId: 'post-fix',
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data: audioDebugSnapshot(data),
      ts: Date.now()
    })
  }).catch(() => {});
}
// #endregion

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  [
    'hero-clock', 'weekday', 'full-date', 'player', 'track-title', 'track-artist',
    'previous-button', 'play-button', 'next-button', 'stop-button', 'favorite-button',
    'hide-button', 'fav-filter-button', 'volume', 'elapsed', 'progress', 'duration',
    'audio', 'queue-count', 'queue-list', 'connection-indicator', 'connection-copy',
    'conversation', 'composer', 'message-input', 'mic-button', 'send-button',
    'profile-button', 'profile-dialog', 'profile-tags', 'taste-content',
    'time-view', 'lyrics-view', 'comments-view', 'lyrics-track', 'lyrics-scroll',
    'comments-count', 'comments-scroll', 'pin-player-button', 'connection-status',
    'chat-focus-button', 'profile-record-title', 'welcome-message', 'welcome-time', 'app-favicon',
    'app-touch-icon', 'response-mode-indicator'
  ].forEach((id) => {
    elements[id] = $(id);
  });
  elements.app = document.querySelector('.app');
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function renderClock() {
  const now = new Date();
  elements['hero-clock'].textContent = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  elements.weekday.textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
  elements['full-date'].textContent = now
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
  renderWelcomeGreeting();
}

function greetingPeriod(now) {
  const hour = now.getHours();
  const weekday = now.toLocaleDateString('zh-CN', { weekday: 'short' });
  if (hour < 5) {
    return {
      key: 'late-night',
      intros: ['夜还很深。', '凌晨频道还亮着。', '还没睡的话，我陪你听一会儿。']
    };
  }
  if (hour < 9) {
    return {
      key: 'morning',
      intros: [`${weekday}早上好。`, '晨间频道已经准备好了。', '新的一天，先让音乐把节奏铺开。']
    };
  }
  if (hour < 12) {
    return {
      key: 'forenoon',
      intros: [`${weekday}上午好。`, '上午的频道已接通。', '工作开始了，让声音留一点呼吸。']
    };
  }
  if (hour < 14) {
    return {
      key: 'noon',
      intros: ['中午好。', '午间留白开始了。', '先把上午放下片刻。']
    };
  }
  if (hour < 18) {
    return {
      key: 'afternoon',
      intros: [`${weekday}下午好。`, '下午的频道继续。', '给接下来的时间换一层声音。']
    };
  }
  if (hour < 22) {
    return {
      key: 'evening',
      intros: ['晚上好。', '晚间频道已经亮起。', '把今天慢慢放下吧。']
    };
  }
  return {
    key: 'night',
    intros: ['夜深了。', '夜间频道已经接手。', '今天快结束了，让声音慢下来。']
  };
}

function shortGreetingLabel(value, maxLength = 34) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function greetingStatus() {
  const directive = state.autoplayDirective;
  const directiveActive = Boolean(
    directive?.active
    && directive.directive?.instruction
    && (!directive.directive.expiresAt || Date.parse(directive.directive.expiresAt) > Date.now())
  );
  if (directiveActive) {
    const instruction = shortGreetingLabel(directive.directive.instruction);
    return {
      key: `directive:${instruction}`,
      lines: [
        `当前节目继续围绕「${instruction}」，我会守住这个方向。`,
        `「${instruction}」仍在生效，后面的选择不会跑题。`,
        `这段时间继续按「${instruction}」编排。`
      ]
    };
  }
  if (state.connectionKnown && !state.connected) {
    return {
      key: 'reconnecting',
      lines: [
        '信号正在恢复，本地队列和播放进度都还在。',
        '我正在重新接回电台，当前节目不会丢失。',
        '连接暂时不稳，先让本地队列继续工作。'
      ]
    };
  }
  const track = currentTrack();
  const title = shortGreetingLabel(track?.title, 28);
  const remaining = Math.max(0, state.tracks.length - state.currentIndex - 1);
  if (state.playing) {
    return {
      key: `playing:${track?.id || title}:${remaining}`,
      lines: [
        `《${title}》正在播放，后面还有 ${remaining} 首，我会接着排。`,
        `现在听到的是《${title}》，后续节目已经接好。`,
        `节目进行到《${title}》，下一首会自然跟上。`
      ]
    };
  }
  return {
    key: `paused:${track?.id || title}:${remaining}`,
    lines: [
      `播放停在《${title}》，想继续时按下播放。`,
      `《${title}》在这里等你，随时可以继续。`,
      `当前停在《${title}》，我先替你守住这个位置。`
    ]
  };
}

function randomGreetingIndex(length) {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function renderWelcomeGreeting(force = false) {
  if (!elements['welcome-message']) return;
  const period = greetingPeriod(new Date());
  const status = greetingStatus();
  const contextKey = [
    period.key,
    status.key,
    state.assistantName,
    state.connectionKnown ? String(state.connected) : 'unknown'
  ].join('|');
  if (!force && contextKey === state.greetingContextKey) return;

  const candidates = period.intros.flatMap((intro, index) => [
    `${intro}我是 ${state.assistantName}。${status.lines[index % status.lines.length]}`,
    `${intro}${status.lines[(index + 1) % status.lines.length]}`
  ]);
  const available = candidates.filter((candidate) =>
    candidate !== state.currentGreeting && candidate !== state.previousPageGreeting
  );
  const pool = available.length ? available : candidates;
  const greeting = pool[randomGreetingIndex(pool.length)];

  state.greetingContextKey = contextKey;
  state.currentGreeting = greeting;
  elements['welcome-message'].textContent = greeting;
  if (elements['welcome-time']) elements['welcome-time'].textContent = messageTime();
  localStorage.setItem('swagger-last-greeting', greeting);
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content =
    state.theme === 'dark' ? '#08090d' : '#f5f5f1';
  document.querySelectorAll('[data-theme-value]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeValue === state.theme);
  });
  localStorage.setItem('claudio-theme', state.theme);
}

function setPlayerPinned(pinned) {
  state.playerPinned = Boolean(pinned);
  elements.player.classList.toggle('pinned', state.playerPinned);
  elements['pin-player-button'].classList.toggle('active', state.playerPinned);
  elements['pin-player-button'].setAttribute('aria-pressed', String(state.playerPinned));
  elements['pin-player-button'].setAttribute(
    'aria-label',
    state.playerPinned ? '取消播放器吸顶' : '播放器吸顶'
  );
  elements['pin-player-button'].title = state.playerPinned ? '取消播放器吸顶' : '播放器吸顶';
  elements['pin-player-button'].innerHTML =
    `<i data-lucide="${state.playerPinned ? 'pin' : 'pin-off'}"></i>`;
  localStorage.setItem('claudio-player-pinned', String(state.playerPinned));
  refreshIcons();
}

function setChatFocus(enabled) {
  state.chatFocus = Boolean(enabled);
  elements.app.classList.toggle('chat-focus', state.chatFocus);
  document.body.classList.toggle('chat-focus-active', state.chatFocus);
  elements['chat-focus-button'].setAttribute('aria-pressed', String(state.chatFocus));
  elements['chat-focus-button'].setAttribute(
    'aria-label',
    state.chatFocus ? '退出全屏聊天' : '全屏聊天'
  );
  elements['chat-focus-button'].title = state.chatFocus ? '退出全屏聊天' : '全屏聊天';
  elements['chat-focus-button'].innerHTML =
    `<i data-lucide="${state.chatFocus ? 'minimize-2' : 'maximize-2'}"></i>`;
  refreshIcons();
  if (state.chatFocus) {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
    elements['message-input'].focus();
  }
}

function setPlayerCollapsed(collapsed) {
  elements.player.classList.toggle('collapsed', collapsed);
  elements['hide-button'].classList.toggle('waveform-toggle', collapsed);
  elements['hide-button'].setAttribute('aria-label', collapsed ? '展开播放器' : '折叠播放器');
  elements['hide-button'].title = collapsed ? '展开播放器' : '折叠播放器';
  if (collapsed) {
    elements['hide-button'].innerHTML = `
      <span class="mini-wave" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i>
      </span>
    `;
  } else {
    elements['hide-button'].textContent = 'HIDE';
  }
}

function applySettings(settings) {
  if (settings?.appearance) window.AlbumView?.setStyle(settings.appearance.playerStyle);
  if (settings?.avatarUrl) {
    state.avatarUrl = `/api/avatar?v=${encodeURIComponent(settings.avatarUrl)}`;
    document.querySelectorAll('[data-claudio-avatar]').forEach((image) => {
      image.src = state.avatarUrl;
    });
    elements['app-favicon'].href = '/assets/forever-icon-192.png';
    elements['app-touch-icon'].href = '/assets/forever-icon-512.png';
  }
  if (settings?.assistantName) {
    state.assistantName = settings.assistantName;
    document.querySelectorAll('[data-claudio-name]').forEach((element) => {
      element.textContent = element.classList.contains('message-author')
        ? state.assistantName.toUpperCase()
        : state.assistantName;
    });
    elements['profile-record-title'].textContent =
      `LOCAL DJ PROFILE / ${state.assistantName.toUpperCase()}-01`;
    elements['profile-button'].setAttribute('aria-label', `查看 ${state.assistantName} 档案`);
    elements['profile-button'].querySelector('img').alt = state.assistantName;
    document.querySelector('.profile-avatar-large img').alt = state.assistantName;
    elements.conversation.setAttribute('aria-label', `与 ${state.assistantName} 的对话`);
    document.querySelector('label[for="message-input"]').textContent =
      `对 ${state.assistantName} 说`;
    document.title = `${state.assistantName} - Private AI Radio`;
  }
  if (Array.isArray(settings?.genres)) renderProfileGenres(settings.genres);
  if (settings?.recommendation?.responseMode) {
    state.responseMode = settings.recommendation.responseMode;
    const labels = {
      direct: 'DIRECT',
      playlist: 'PLAYLIST',
      interactive: 'INTERACTIVE'
    };
    elements['response-mode-indicator'].textContent =
      `LIVE CHAT · ${labels[state.responseMode] || 'DIRECT'}`;
  }
  renderWelcomeGreeting();
}

function renderProfileGenres(genres) {
  state.genres = genres.length ? genres : [...DEFAULT_GENRES];
  elements['profile-tags'].replaceChildren(
    ...state.genres.map((genre) => {
      const tag = document.createElement('span');
      tag.textContent = genre;
      return tag;
    })
  );
}

function renderTasteProfile(markdown) {
  const lines = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines.find((line) => line.startsWith('#'))?.replace(/^#+\s*/, '') || 'My Taste';
  const items = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ''));
  const paragraphs = lines.filter((line) => !line.startsWith('#') && !/^[-*]\s+/.test(line));

  elements['taste-content'].replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = `# ${title}`;
  elements['taste-content'].append(heading);
  if (items.length) {
    const list = document.createElement('ul');
    items.forEach((item) => {
      const row = document.createElement('li');
      row.textContent = item;
      list.append(row);
    });
    elements['taste-content'].append(list);
  }
  paragraphs.forEach((text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    elements['taste-content'].append(paragraph);
  });
}

function currentTrack() {
  return state.tracks[state.currentIndex] || fallbackTracks[0];
}

function renderStageEmpty(container, text) {
  const message = document.createElement('p');
  message.className = 'stage-empty';
  message.textContent = text;
  container.replaceChildren(message);
}

function renderLyrics(lines) {
  state.activeLyricIndex = -1;
  if (!lines.length) {
    renderStageEmpty(elements['lyrics-scroll'], '这首歌暂时没有可用歌词');
    return;
  }
  elements['lyrics-scroll'].replaceChildren(
    ...lines.map((line) => {
      const row = document.createElement('div');
      row.className = 'lyric-line';
      row.dataset.time = String(line.time);
      const text = document.createElement('span');
      text.textContent = line.text;
      row.append(text);
      if (line.translation) {
        const translation = document.createElement('small');
        translation.textContent = line.translation;
        row.append(translation);
      }
      return row;
    })
  );
  updateLyricsProgress(true);
}

function renderComments(payload) {
  elements['comments-count'].textContent = `${payload.total || 0} COMMENTS`;
  if (!payload.items?.length) {
    renderStageEmpty(elements['comments-scroll'], '这首歌暂时没有公开评论');
    return;
  }
  elements['comments-scroll'].replaceChildren(
    ...payload.items.map((comment) => {
      const article = document.createElement('article');
      article.className = 'listener-comment';
      const header = document.createElement('header');
      const user = document.createElement('strong');
      user.textContent = comment.user;
      header.append(user);
      if (comment.kind === 'hot') {
        const badge = document.createElement('span');
        badge.textContent = 'HOT';
        header.append(badge);
      }
      const content = document.createElement('p');
      content.textContent = comment.content;
      const footer = document.createElement('footer');
      const date = document.createElement('time');
      date.textContent = comment.timeLabel || '网易云音乐';
      const likes = document.createElement('span');
      likes.innerHTML = `<i data-lucide="heart"></i>${comment.likedCount}`;
      footer.append(date, likes);
      article.append(header, content, footer);
      return article;
    })
  );
  refreshIcons();
}

function updateLyricsProgress(force = false) {
  if (state.stageMode !== 'lyrics') return;
  const lines = state.lyricsByTrack.get(currentTrack().id) || [];
  if (!lines.length) return;
  let activeIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].time <= state.elapsed + 0.15) activeIndex = index;
    else break;
  }
  if (!force && activeIndex === state.activeLyricIndex) return;
  state.activeLyricIndex = activeIndex;
  const rows = [...elements['lyrics-scroll'].querySelectorAll('.lyric-line')];
  rows.forEach((row, index) => {
    row.classList.toggle('active', index === activeIndex);
    row.classList.toggle('past', index < activeIndex);
  });
  const active = rows[activeIndex];
  if (active) {
    elements['lyrics-scroll'].scrollTo({
      top: active.offsetTop - (elements['lyrics-scroll'].clientHeight / 2) + (active.offsetHeight / 2),
      behavior: state.playing && !force ? 'smooth' : 'auto'
    });
  } else if (force) {
    elements['lyrics-scroll'].scrollTop = 0;
  }
}

async function loadStageContent() {
  if (state.stageMode === 'time') return;
  const mode = state.stageMode;
  const track = currentTrack();
  const title = `${track.title} / ${track.artist}`.toUpperCase();
  const requestToken = ++state.stageRequestToken;

  if (mode === 'lyrics') {
    elements['lyrics-track'].textContent = title;
    const cached = state.lyricsByTrack.get(track.id);
    if (cached) {
      renderLyrics(cached);
      return;
    }
    renderStageEmpty(elements['lyrics-scroll'], '正在读取歌词...');
    try {
      const response = await fetch(`/api/track/${encodeURIComponent(track.id)}/lyrics`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      state.lyricsByTrack.set(track.id, payload.lines || []);
      if (requestToken === state.stageRequestToken && currentTrack().id === track.id) {
        renderLyrics(payload.lines || []);
      }
    } catch (error) {
      if (requestToken === state.stageRequestToken) {
        renderStageEmpty(elements['lyrics-scroll'], '歌词暂时不可用');
      }
    }
    return;
  }

  const cached = state.commentsByTrack.get(track.id);
  if (cached) {
    renderComments(cached);
    return;
  }
  elements['comments-count'].textContent = '-- COMMENTS';
  renderStageEmpty(elements['comments-scroll'], '正在读取评论...');
  try {
    const response = await fetch(`/api/track/${encodeURIComponent(track.id)}/comments?limit=20`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    state.commentsByTrack.set(track.id, payload);
    if (requestToken === state.stageRequestToken && currentTrack().id === track.id) {
      renderComments(payload);
    }
  } catch (error) {
    if (requestToken === state.stageRequestToken) {
      renderStageEmpty(elements['comments-scroll'], '评论暂时不可用');
    }
  }
}

function setStageMode(mode) {
  if (!['time', 'lyrics', 'comments'].includes(mode)) return;
  state.stageMode = mode;
  document.querySelectorAll('[data-stage-mode]').forEach((button) => {
    const active = button.dataset.stageMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  ['time', 'lyrics', 'comments'].forEach((name) => {
    elements[`${name}-view`].hidden = name !== mode;
  });
  loadStageContent();
}

function renderPlaybackProgress() {
  const track = currentTrack();
  elements.progress.value = String(state.elapsed);
  elements.elapsed.textContent = formatDuration(state.elapsed);
  elements.duration.textContent = formatDuration(track.duration || 180);
  updateLyricsProgress();
  window.AlbumView?.tick();
  if (state.tracks.length - state.currentIndex <= 2) ensureQueueContinuation();
}

function renderPlayer() {
  const track = currentTrack();
  const quality = track.quality ? ` · ${track.quality.toUpperCase()}` : '';
  elements['track-title'].textContent = track.title;
  elements['track-artist'].textContent =
    `${track.artist}${quality} · ${state.playing ? 'PLAYING' : 'PAUSED'}`;
  elements.progress.max = String(track.duration || 180);
  elements.player.classList.toggle('paused', !state.playing);
  elements['favorite-button'].classList.toggle('active', state.favorites.has(track.id));
  elements['play-button'].innerHTML = `<i data-lucide="${state.playing ? 'pause' : 'play'}"></i>`;
  elements['play-button'].setAttribute('aria-label', state.playing ? '暂停' : '播放');
  renderPlaybackProgress();
  window.AlbumView?.render();
  refreshIcons();
}

function renderQueue() {
  window.AlbumView?.render();
  const visibleTracks = state.tracks.filter((track) =>
    !state.favoriteOnly || state.favorites.has(track.id)
  );
  elements['queue-count'].textContent = `${visibleTracks.length} TRACK${visibleTracks.length === 1 ? '' : 'S'}`;
  elements['queue-list'].replaceChildren(
    ...visibleTracks.map((track) => {
      const row = document.createElement('div');
      const index = state.tracks.findIndex((candidate) => candidate.id === track.id);
      row.className = 'queue-item';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.dataset.index = String(index);
      row.setAttribute('aria-current', index === state.currentIndex ? 'true' : 'false');

      const avatar = document.createElement('span');
      avatar.className = 'queue-avatar';
      const copy = document.createElement('div');
      copy.className = 'queue-copy';
      const title = document.createElement('strong');
      title.textContent = track.title;
      const artist = document.createElement('span');
      artist.textContent = track.artist;
      copy.append(title, artist);
      const status = document.createElement('span');
      status.className = 'queue-status';
      status.textContent = index === state.currentIndex ? 'LIVE' : formatDuration(track.duration);
      row.append(avatar, copy, status);
      return row;
    })
  );
  window.AlbumView?.renderQueueCovers();
  renderWelcomeGreeting();
}

function stopTones() {
  state.oscillators.forEach((oscillator) => {
    try {
      oscillator.stop();
    } catch (error) {
      // An oscillator can already be stopped while switching tracks.
    }
  });
  state.oscillators = [];
}

function buildToneBed() {
  if (!state.audioContext || !state.masterGain) return;
  stopTones();
  const track = currentTrack();
  const tones = Array.isArray(track.tones) ? track.tones : fallbackTracks[state.currentIndex % fallbackTracks.length].tones;

  tones.forEach((frequency, index) => {
    const oscillator = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    oscillator.type = index === 0 ? 'sine' : 'triangle';
    oscillator.frequency.value = frequency / (index === 2 ? 2 : 1);
    gain.gain.value = 0.24 / (index + 1);
    oscillator.connect(gain).connect(state.masterGain);
    oscillator.start();
    state.oscillators.push(oscillator);
  });
}

async function ensureAudio() {
  const track = currentTrack();
  state.audioMode = 'music';
  // #region debug-point A:ensure-audio
  reportAudioDebug('A', 'public/app.js:ensureAudio:start', 'preparing music audio', {
    requestedSource: track.url || ''
  });
  // #endregion
  if (track.url) {
    if (elements.audio.dataset.source !== track.url) {
      const resumeAt = Math.max(0, state.elapsed);
      elements.audio.pause();
      elements.audio.srcObject = null;
      elements.audio.src = track.url;
      elements.audio.dataset.source = track.url;
      if (resumeAt > 0) {
        const restorePosition = () => {
          const upperBound = Number.isFinite(elements.audio.duration)
            ? Math.max(0, elements.audio.duration - 0.25)
            : resumeAt;
          elements.audio.currentTime = Math.min(resumeAt, upperBound);
        };
        try {
          restorePosition();
        } catch (error) {
          elements.audio.addEventListener('loadedmetadata', restorePosition, { once: true });
        }
      }
    }
    elements.audio.volume = Number(elements.volume.value) / 100;
    await elements.audio.play();
    // #region debug-point A:audio-play-started
    reportAudioDebug('A', 'public/app.js:ensureAudio:playing', 'music audio play resolved');
    // #endregion
    return;
  }

  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audioContext = new AudioContext();
    state.mediaDestination = state.audioContext.createMediaStreamDestination();
    state.masterGain = state.audioContext.createGain();
    state.masterGain.gain.value = 0.045;
    state.masterGain.connect(state.mediaDestination);
    buildToneBed();
  }
  if (elements.audio.srcObject !== state.mediaDestination.stream) {
    elements.audio.pause();
    elements.audio.removeAttribute('src');
    elements.audio.srcObject = state.mediaDestination.stream;
    elements.audio.dataset.source = 'local-tone-bed';
  }
  elements.audio.volume = Number(elements.volume.value) / 100;
  await state.audioContext.resume();
  await elements.audio.play();
}

async function setPlaying(playing) {
  state.playing = playing;
  window.clearInterval(state.timer);

  if (playing) {
    try {
      await ensureAudio();
      recordCurrentTrack();
    } catch (error) {
      state.playing = false;
    }
  } else {
    if (state.audioMode === 'speech') {
      state.resumeAfterSpeech = false;
      state.speechToken += 1;
      state.speechText = '';
      window.speechSynthesis?.cancel();
      state.audioMode = 'music';
    }
    elements.audio.pause();
    if (state.audioContext) await state.audioContext.suspend();
  }

  if (state.playing) {
    state.timer = window.setInterval(() => {
      if (currentTrack().url) {
        if (state.audioMode === 'music' && Number.isFinite(elements.audio.currentTime)) {
          state.elapsed = elements.audio.currentTime;
        }
      } else {
        state.elapsed += 0.25;
        if (state.elapsed >= (currentTrack().duration || 180)) {
          advanceAfterTrack();
          return;
        }
      }
      renderPlaybackProgress();
    }, 250);
  }
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type: 'player-state',
      data: { playing: state.playing, trackId: currentTrack().id }
    }));
  }
  renderPlayer();
  renderWelcomeGreeting();
}

function recordCurrentTrack() {
  const track = currentTrack();
  const key = String(track?.id || '');
  if (!key || state.lastRecordedTrackId === key) return;
  state.lastRecordedTrackId = key;
  fetch('/api/history/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: key, title: track.title })
  }).catch(() => {
    if (state.lastRecordedTrackId === key) state.lastRecordedTrackId = null;
  });
}

function trackIntroKey(track) {
  return String(track?.id || `${track?.artist || ''}:${track?.title || ''}`);
}

async function preloadTrackIntro(track) {
  if (!track?.special) return null;
  const key = trackIntroKey(track);
  if (state.introCache.has(key)) return state.introCache.get(key);
  if (state.introInflight.has(key)) return state.introInflight.get(key);

  const request = (async () => {
    try {
      const response = await fetch('/api/track/intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      state.introCache.set(key, payload);
      return payload;
    } catch (error) {
      return null;
    } finally {
      state.introInflight.delete(key);
    }
  })();
  state.introInflight.set(key, request);
  return request;
}

async function maybeIntroduceTrack(track) {
  if (!track?.special) return false;
  const key = trackIntroKey(track);
  if (state.introducedTrackIds.has(key)) return false;

  const intro = await preloadTrackIntro(track);
  if (
    !intro?.say
    || trackIntroKey(currentTrack()) !== key
    || !state.playing
  ) return false;

  state.introducedTrackIds.add(key);
  appendMessage('assistant', intro.say, { speech: intro.speech, scroll: false });
  playSpeech(intro.speech, intro.say, { resumeMusic: true });
  return true;
}

async function startSelectedTrack(track) {
  const key = trackIntroKey(track);
  const introduced = await maybeIntroduceTrack(track);
  if (
    !introduced
    && state.playing
    && trackIntroKey(currentTrack()) === key
  ) {
    await setPlaying(true);
  }
}

async function ensureQueueContinuation(force = false) {
  const remaining = state.tracks.length - state.currentIndex - 1;
  if (!force && remaining > 2) return true;
  if (state.continuationPromise) return state.continuationPromise;

  state.continuationPromise = (async () => {
    try {
      const response = await fetch('/api/queue/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current: currentTrack(),
          excludeIds: state.tracks.slice(-300).map((track) => track.id)
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      const knownIds = new Set(state.tracks.map((track) => track.id));
      const additions = (payload.queue || [])
        .map((track, index) => normalizeTrack(track, state.tracks.length + index))
        .filter((track) => {
          if (knownIds.has(track.id)) return false;
          knownIds.add(track.id);
          return true;
        });
      if (!additions.length) return false;
      state.tracks.push(...additions);
      renderQueue();
      additions.filter((track) => track.special).forEach((track) => {
        preloadTrackIntro(track);
      });
      return true;
    } catch (error) {
      return false;
    } finally {
      state.continuationPromise = null;
    }
  })();
  return state.continuationPromise;
}

async function goToNext() {
  const keepPlaying = state.playing;
  if (state.currentIndex >= state.tracks.length - 1) {
    await ensureQueueContinuation(true);
  }
  if (state.currentIndex < state.tracks.length - 1) {
    selectTrack(state.currentIndex + 1, keepPlaying);
    return true;
  }
  return false;
}

async function advanceAfterTrack() {
  if (state.advancingTrack) return;
  state.advancingTrack = true;
  window.clearInterval(state.timer);
  try {
    if (state.currentIndex >= state.tracks.length - 1) {
      await ensureQueueContinuation(true);
    }
    if (state.currentIndex < state.tracks.length - 1) {
      selectTrack(state.currentIndex + 1, true);
    } else {
      await setPlaying(false);
    }
  } finally {
    state.advancingTrack = false;
  }
}

function selectTrack(index, keepPlaying = state.playing) {
  // #region debug-point A-E:select-track
  reportAudioDebug('A-E', 'public/app.js:selectTrack', 'track selection requested', {
    requestedIndex: index,
    keepPlaying: Boolean(keepPlaying),
    caller: new Error().stack?.split('\n').slice(1, 4).join(' | ') || ''
  });
  // #endregion
  const shouldKeepPlaying = Boolean(keepPlaying);
  window.clearInterval(state.timer);
  elements.audio.pause();
  if (state.audioMode === 'speech') {
    state.resumeAfterSpeech = false;
    state.speechToken += 1;
    state.speechText = '';
    window.speechSynthesis?.cancel();
    state.audioMode = 'music';
  }
  state.currentIndex = Math.max(0, Math.min(state.tracks.length - 1, index));
  state.elapsed = 0;
  state.playing = shouldKeepPlaying;
  state.musicErrorRetryCount = 0;
  state.activeLyricIndex = -1;
  state.stageRequestToken += 1;
  buildToneBed();
  renderPlayer();
  renderQueue();
  loadStageContent();
  ensureQueueContinuation();
  renderWelcomeGreeting();
  if (shouldKeepPlaying) startSelectedTrack(currentTrack());
}

async function applyPlayerAction(action) {
  const controls = {
    play: elements['play-button'],
    pause: elements['play-button'],
    previous: elements['previous-button'],
    next: elements['next-button'],
    stop: elements['stop-button']
  };
  const button = controls[action];
  if (!button) return;
  button.classList.add('assistant-triggered');
  window.setTimeout(() => button.classList.remove('assistant-triggered'), 700);

  if (action === 'play') {
    await setPlaying(true);
  } else if (action === 'pause') {
    await setPlaying(false);
  } else if (action === 'previous') {
    selectTrack(
      (state.currentIndex - 1 + state.tracks.length) % state.tracks.length,
      state.playing
    );
  } else if (action === 'next') {
    await goToNext();
  } else if (action === 'stop') {
    state.elapsed = 0;
    await setPlaying(false);
  }
}

function setConnected(connected) {
  state.connected = Boolean(connected);
  state.connectionKnown = true;
  elements['connection-status'].classList.toggle('connected', connected);
  elements['connection-copy'].textContent = connected
    ? 'ON AIR'
    : 'RECONNECTING';
  renderWelcomeGreeting();
}

function messageTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function responseArtifactId(prefix) {
  state.responseArtifactSequence += 1;
  return `${prefix}-${Date.now()}-${state.responseArtifactSequence}`;
}

function trackCoverPath(track) {
  return /^(?:\d{1,20}|qq:[A-Za-z0-9]{6,64})$/.test(String(track.id || ''))
    ? `/api/track/${encodeURIComponent(track.id)}/cover`
    : '';
}

function createPlaylistCard(tracks) {
  const normalizedTracks = tracks.map(normalizeTrack);
  const artifactId = responseArtifactId('playlist');
  state.responseArtifacts.set(artifactId, { type: 'playlist', tracks: normalizedTracks });

  const card = document.createElement('section');
  card.className = 'message-playlist';
  card.dataset.artifactId = artifactId;
  card.setAttribute('aria-label', `临时歌单，共 ${normalizedTracks.length} 首`);

  const header = document.createElement('header');
  const heading = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.textContent = 'TEMPORARY PLAYLIST';
  const title = document.createElement('strong');
  title.textContent = '本次推荐';
  heading.append(eyebrow, title);
  const playAll = document.createElement('button');
  playAll.type = 'button';
  playAll.dataset.playlistAction = 'all';
  playAll.innerHTML = '<i data-lucide="play"></i><span>播放全部</span>';
  header.append(heading, playAll);

  const list = document.createElement('ol');
  normalizedTracks.forEach((track, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.playlistIndex = String(index);
    button.setAttribute('aria-label', `从 ${track.title} 开始播放`);

    const cover = document.createElement('span');
    cover.className = 'message-track-cover';
    const coverPath = trackCoverPath(track);
    if (coverPath) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove());
      image.src = coverPath;
      cover.append(image);
    }
    const copy = document.createElement('span');
    copy.className = 'message-track-copy';
    const trackTitle = document.createElement('strong');
    trackTitle.textContent = track.title;
    const detail = document.createElement('small');
    detail.textContent = `${track.artist} · ${track.provider === 'qq' ? 'QQ 音乐' : '网易云'} · ${formatDuration(track.duration)}`;
    copy.append(trackTitle, detail);
    const icon = document.createElement('i');
    icon.dataset.lucide = 'play';
    button.append(cover, copy, icon);
    item.append(button);
    list.append(item);
  });
  card.append(header, list);
  return card;
}

function createChoiceGroup(choices) {
  const artifactId = responseArtifactId('choices');
  state.responseArtifacts.set(artifactId, { type: 'choices', choices });
  const group = document.createElement('div');
  group.className = 'message-choices';
  group.dataset.artifactId = artifactId;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', '选择推荐方向');
  choices.forEach((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.choiceId = choice.id;
    button.setAttribute('aria-pressed', 'false');
    const label = document.createElement('strong');
    label.textContent = choice.label;
    const description = document.createElement('span');
    description.textContent = choice.description;
    const icon = document.createElement('i');
    icon.dataset.lucide = 'arrow-up-right';
    button.append(label, description, icon);
    group.append(button);
  });
  return group;
}

function appendMessage(role, text, options = {}) {
  const article = document.createElement('article');
  article.className = `message ${role}${options.typing ? ' typing' : ''}`;
  if (options.speech?.url) article.dataset.speechUrl = options.speech.url;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    const image = document.createElement('img');
    image.src = state.avatarUrl;
    image.dataset.claudioAvatar = '';
    image.alt = '';
    avatar.append(image);
    article.append(avatar);
  }

  const body = document.createElement('div');
  body.className = 'message-body';
  if (role === 'assistant') {
    const author = document.createElement('span');
    author.className = 'message-author';
    author.dataset.claudioName = '';
    author.textContent = state.assistantName.toUpperCase();
    body.append(author);
  }

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  body.append(bubble);
  if (role === 'assistant' && Array.isArray(options.playlist) && options.playlist.length) {
    body.append(createPlaylistCard(options.playlist));
  }
  if (role === 'assistant' && Array.isArray(options.choices) && options.choices.length) {
    body.append(createChoiceGroup(options.choices));
  }

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const time = document.createElement('time');
  time.textContent = messageTime();
  meta.append(time);
  if (role === 'assistant' && !options.typing) {
    const replay = document.createElement('button');
    replay.className = 'replay-button';
    replay.type = 'button';
    replay.dataset.replay = '';
    replay.textContent = '▶ REPLAY';
    meta.append(replay);
  }
  body.append(meta);
  article.append(body);
  elements.conversation.append(article);
  refreshIcons();
  if (options.scroll !== false) {
    if (['album', 'glass'].includes(document.documentElement.dataset.playerStyle)) {
      elements.conversation.scrollTo({ top: elements.conversation.scrollHeight, behavior: 'smooth' });
    } else {
      article.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  return article;
}

function speak(text, onEnd = () => {}) {
  if (!('speechSynthesis' in window)) {
    onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.92;
  utterance.pitch = 0.86;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onEnd();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
}

function setVoiceInputActive(active) {
  elements.composer.classList.toggle('listening', active);
  elements['mic-button'].classList.toggle('active', active);
  elements['mic-button'].setAttribute('aria-label', active ? '停止并提交语音' : '语音输入');
  elements['mic-button'].title = active ? '停止并提交语音' : '语音输入';
  elements['message-input'].placeholder = active
    ? 'Listening... release to send'
    : 'Say something to the DJ...';
}

function startVoiceInput(autoSubmit = false) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    elements['message-input'].placeholder = '当前浏览器不支持语音输入';
    return false;
  }
  if (state.recognition) {
    state.voiceAutoSubmit ||= autoSubmit;
    return true;
  }

  const recognition = new Recognition();
  state.recognition = recognition;
  state.voiceTranscript = '';
  state.voiceAutoSubmit = autoSubmit;
  state.voiceStopPending = false;
  elements['message-input'].value = '';
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => {
    if (state.voiceStopPending) recognition.stop();
  };
  recognition.onresult = (event) => {
    let transcript = '';
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index][0]?.transcript || '';
    }
    state.voiceTranscript = transcript.trim();
    elements['message-input'].value = transcript;
  };
  recognition.onerror = () => {
    state.voiceAutoSubmit = false;
  };
  recognition.onend = () => {
    if (state.recognition !== recognition) return;
    const shouldSubmit = state.voiceAutoSubmit;
    const transcript = state.voiceTranscript.trim();
    state.recognition = null;
    state.voiceAutoSubmit = false;
    state.voiceStopPending = false;
    setVoiceInputActive(false);
    if (shouldSubmit && transcript) sendMessage(transcript);
  };
  try {
    recognition.start();
    setVoiceInputActive(true);
    return true;
  } catch (error) {
    state.recognition = null;
    setVoiceInputActive(false);
    return false;
  }
}

function stopVoiceInput(autoSubmit = false) {
  if (!state.recognition) return;
  state.voiceAutoSubmit ||= autoSubmit;
  try {
    state.recognition.stop();
  } catch (error) {
    state.voiceStopPending = true;
  }
}

function startVoiceHold() {
  if (state.voiceHoldTimer || state.voiceHoldActive || state.recognition) return;
  elements.composer.classList.add('voice-arming');
  state.voiceHoldTimer = window.setTimeout(() => {
    state.voiceHoldTimer = null;
    elements.composer.classList.remove('voice-arming');
    state.voiceHoldActive = startVoiceInput(true);
  }, 320);
}

function endVoiceHold() {
  if (state.voiceHoldTimer) {
    window.clearTimeout(state.voiceHoldTimer);
    state.voiceHoldTimer = null;
    elements.composer.classList.remove('voice-arming');
  }
  if (state.voiceHoldActive) {
    state.voiceHoldActive = false;
    stopVoiceInput(true);
  }
}

function isEditableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, button, [contenteditable="true"]'));
}

function finishSpeechPlayback(token) {
  if (state.audioMode !== 'speech' || token !== state.speechToken) return;
  const shouldResume = state.resumeAfterSpeech && state.playing;
  state.audioMode = 'music';
  state.resumeAfterSpeech = false;
  state.speechText = '';
  if (shouldResume) setPlaying(true);
  else renderPlayer();
}

async function playSpeech(speech, text, options = {}) {
  // #region debug-point E:speech-start
  reportAudioDebug('E', 'public/app.js:playSpeech', 'speech playback requested', {
    hasCloudAudio: Boolean(speech?.url),
    resumeMusic: options.resumeMusic ?? state.playing
  });
  // #endregion
  const resumeMusic = options.resumeMusic ?? state.playing;
  if (
    state.audioMode === 'music'
    && currentTrack().url
    && elements.audio.dataset.source === currentTrack().url
    && Number.isFinite(elements.audio.currentTime)
  ) {
    state.elapsed = elements.audio.currentTime;
  }
  window.clearInterval(state.timer);
  elements.audio.pause();
  window.speechSynthesis?.cancel();
  const token = state.speechToken + 1;
  state.speechToken = token;
  state.audioMode = 'speech';
  state.resumeAfterSpeech = Boolean(resumeMusic);
  state.speechText = text;

  if (!speech?.url) {
    speak(text, () => finishSpeechPlayback(token));
    return;
  }

  elements.audio.srcObject = null;
  elements.audio.src = speech.url;
  elements.audio.dataset.source = speech.url;
  try {
    await elements.audio.play();
  } catch (error) {
    speak(text, () => finishSpeechPlayback(token));
  }
}

async function handleAudioEnded() {
  // #region debug-point A-E:audio-ended
  reportAudioDebug('A-E', 'public/app.js:handleAudioEnded', 'audio ended event');
  // #endregion
  if (state.audioMode === 'speech') {
    finishSpeechPlayback(state.speechToken);
    return;
  }
  if (state.playing) await advanceAfterTrack();
}

async function handleAudioError() {
  // #region debug-point A-C-E:audio-error
  reportAudioDebug('A-C-E', 'public/app.js:handleAudioError', 'audio error event');
  // #endregion
  if (state.audioMode === 'speech') {
    const token = state.speechToken;
    const text = state.speechText;
    elements.audio.pause();
    speak(text, () => finishSpeechPlayback(token));
    return;
  }
  if (!state.playing || state.handlingAudioError) return;

  state.handlingAudioError = true;
  try {
    if (currentTrack().url && state.musicErrorRetryCount < 1) {
      state.musicErrorRetryCount += 1;
      elements.audio.pause();
      elements.audio.dataset.source = '';
      elements.audio.removeAttribute('src');
      elements.audio.load();
      try {
        await ensureAudio();
        return;
      } catch (error) {
        // Advance below when the single source retry also fails.
      }
    }
    await advanceAfterTrack();
  } finally {
    state.handlingAudioError = false;
  }
}

async function replayMessage(article) {
  const text = article.querySelector('.message-bubble')?.textContent.trim();
  if (!text) return;
  let speech = article.dataset.speechUrl
    ? { url: article.dataset.speechUrl }
    : null;

  if (!speech) {
    try {
      const response = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (response.ok) {
        speech = await response.json();
        if (speech.url) article.dataset.speechUrl = speech.url;
      }
    } catch (error) {
      // Browser speech remains the final offline fallback.
    }
  }
  await playSpeech(speech, text);
}

function replaceQueueFromPlaylist(tracks, startIndex = 0) {
  const normalized = tracks.map(normalizeTrack);
  const selected = normalized[startIndex];
  if (!selected) return;
  state.tracks = [selected, ...normalized.filter((track, index) => index !== startIndex)];
  state.currentIndex = 0;
  state.elapsed = 0;
  state.activeLyricIndex = -1;
  state.stageRequestToken += 1;
  renderPlayer();
  renderQueue();
  loadStageContent();
  ensureQueueContinuation();
  void setPlaying(true);
}

async function sendMessage(text, options = {}) {
  const value = text.trim();
  if (!value || elements.composer.classList.contains('pending')) return;
  appendMessage('user', options.displayText || value);
  elements['message-input'].value = '';
  elements.composer.classList.add('pending');
  const pending = appendMessage('assistant', `${state.assistantName} is thinking...`, { typing: true });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    pending.remove();
    appendMessage('assistant', data.say, {
      speech: data.speech,
      playlist: data.responseMode === 'playlist' ? data.queue : [],
      choices: data.responseMode === 'interactive' ? data.choices : []
    });
    if (Array.isArray(data.queue) && data.queue.length) {
      state.tracks = data.queue.map(normalizeTrack);
      state.currentIndex = 0;
      state.elapsed = 0;
      state.activeLyricIndex = -1;
      state.stageRequestToken += 1;
      renderPlayer();
      renderQueue();
      loadStageContent();
      ensureQueueContinuation();
    }
    await applyPlayerAction(data.playerAction || data.action || 'none');
    playSpeech(data.speech, data.say);
  } catch (error) {
    pending.querySelector('.message-bubble').textContent = '本地服务暂时没有响应。你的请求没有丢失，可以稍后重试。';
    pending.classList.remove('typing');
  } finally {
    elements.composer.classList.remove('pending');
    elements['message-input'].focus();
  }
}

function normalizeTrack(track, index = 0) {
  const fallback = fallbackTracks[index % fallbackTracks.length];
  return {
    id: String(track.id || fallback.id),
    title: track.title || track.name || fallback.title,
    artist: track.artist || fallback.artist,
    duration: Number(track.duration || track.durationSeconds || fallback.duration),
    url: track.url || null,
    quality: track.quality || '',
    album: track.album || '',
    coverUrl: track.coverUrl || '',
    provider: track.provider || (/^qq:/.test(String(track.id || '')) ? 'qq' : 'netease'),
    sourceId: track.sourceId || String(track.id || fallback.id).replace(/^qq:/, ''),
    special: Boolean(track.special),
    intro: track.intro || null,
    recommendationType: track.recommendationType || '',
    tones: fallback.tones
  };
}

async function loadStation() {
  try {
    const [nowResponse, nextResponse] = await Promise.all([
      fetch('/api/now'),
      fetch('/api/next')
    ]);
    if (!nowResponse.ok || !nextResponse.ok) return;
    const now = await nowResponse.json();
    const next = await nextResponse.json();
    const current = normalizeTrack(now.current || now, 0);
    const upcoming = (next.next || []).map((track, index) => normalizeTrack(track, index + 1));
    state.tracks = [current, ...upcoming];
    renderPlayer();
    renderQueue();
    loadStageContent();
    ensureQueueContinuation();
    renderWelcomeGreeting();
  } catch (error) {
    // The bundled station remains available when an adapter is offline.
  }
}

async function loadAutoplayDirective() {
  try {
    const response = await fetch('/api/autoplay/directive');
    if (!response.ok) return;
    state.autoplayDirective = await response.json();
    renderWelcomeGreeting();
  } catch (error) {
    // A greeting can still reflect the local player state.
  }
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (response.ok) applySettings(await response.json());
  } catch (error) {
    // Keep the bundled avatar when settings cannot be loaded.
  }
}

function connectStream() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}/stream`);
  state.ws.addEventListener('open', () => setConnected(true));
  state.ws.addEventListener('close', () => {
    setConnected(false);
    window.setTimeout(connectStream, 3000);
  });
  state.ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'now-playing' && message.data) {
      const incoming = normalizeTrack(message.data, 0);
      const existingIndex = state.tracks.findIndex((track) => track.id === incoming.id);
      if (existingIndex >= 0) selectTrack(existingIndex);
    }
    if (message.type === 'settings') applySettings(message.data);
    if (message.type === 'autoplay-directive') {
      state.autoplayDirective = message.data;
      renderWelcomeGreeting();
    }
    if (message.type === 'profile') {
      renderProfileGenres(message.data.genres || []);
      renderTasteProfile(message.data.taste || '');
    }
  });
}

function bindEvents() {
  document.querySelectorAll('[data-theme-value]').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeValue));
  });
  document.querySelectorAll('[data-stage-mode]').forEach((button) => {
    button.addEventListener('click', () => setStageMode(button.dataset.stageMode));
  });

  elements['play-button'].addEventListener('click', () => setPlaying(!state.playing));
  elements['previous-button'].addEventListener('click', () => {
    selectTrack((state.currentIndex - 1 + state.tracks.length) % state.tracks.length);
  });
  elements['next-button'].addEventListener('click', () => {
    goToNext();
  });
  elements['stop-button'].addEventListener('click', () => {
    state.elapsed = 0;
    setPlaying(false);
  });
  elements['favorite-button'].addEventListener('click', () => {
    const id = currentTrack().id;
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    renderPlayer();
    renderQueue();
  });
  elements['hide-button'].addEventListener('click', () => {
    setPlayerCollapsed(!elements.player.classList.contains('collapsed'));
  });
  elements['pin-player-button'].addEventListener('click', () => {
    setPlayerPinned(!state.playerPinned);
  });
  elements['fav-filter-button'].addEventListener('click', () => {
    state.favoriteOnly = !state.favoriteOnly;
    elements['fav-filter-button'].classList.toggle('active', state.favoriteOnly);
    renderQueue();
  });
  elements.volume.addEventListener('input', () => {
    elements.audio.volume = Number(elements.volume.value) / 100;
  });
  elements.audio.addEventListener('ended', handleAudioEnded);
  elements.audio.addEventListener('error', handleAudioError);
  // #region debug-point A-C:media-events
  ['abort', 'stalled', 'suspend', 'waiting', 'loadedmetadata'].forEach((eventName) => {
    elements.audio.addEventListener(eventName, () => {
      reportAudioDebug('A-C', `public/app.js:media:${eventName}`, `audio ${eventName} event`);
    });
  });
  // #endregion
  elements.progress.addEventListener('input', () => {
    state.elapsed = Number(elements.progress.value);
    if (currentTrack().url && Number.isFinite(elements.audio.duration)) {
      elements.audio.currentTime = state.elapsed;
    }
    renderPlaybackProgress();
  });

  elements['queue-list'].addEventListener('click', (event) => {
    const row = event.target.closest('.queue-item');
    if (row) selectTrack(Number(row.dataset.index));
  });
  elements['queue-list'].addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const row = event.target.closest('.queue-item');
      if (row) selectTrack(Number(row.dataset.index));
    }
  });

  elements.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(elements['message-input'].value);
  });

  elements.conversation.addEventListener('click', (event) => {
    const replayButton = event.target.closest('[data-replay]');
    if (replayButton) {
      replayMessage(replayButton.closest('.message'));
      return;
    }
    const playlistButton = event.target.closest('[data-playlist-action], [data-playlist-index]');
    if (playlistButton) {
      const artifact = state.responseArtifacts.get(
        playlistButton.closest('[data-artifact-id]')?.dataset.artifactId
      );
      if (artifact?.type === 'playlist') {
        const startIndex = playlistButton.dataset.playlistAction === 'all'
          ? 0
          : Number(playlistButton.dataset.playlistIndex);
        replaceQueueFromPlaylist(artifact.tracks, startIndex);
      }
      return;
    }
    const choiceButton = event.target.closest('[data-choice-id]');
    if (!choiceButton || choiceButton.disabled) return;
    const group = choiceButton.closest('[data-artifact-id]');
    const artifact = state.responseArtifacts.get(group?.dataset.artifactId);
    const choice = artifact?.choices?.find((item) => item.id === choiceButton.dataset.choiceId);
    if (!choice) return;
    group.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
      button.classList.toggle('selected', button === choiceButton);
      button.setAttribute('aria-pressed', String(button === choiceButton));
    });
    sendMessage(choice.prompt, { displayText: choice.label });
  });
  elements['chat-focus-button'].addEventListener('click', () => {
    setChatFocus(!state.chatFocus);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.chatFocus) setChatFocus(false);
  });

  elements['profile-button'].addEventListener('click', async () => {
    elements['profile-dialog'].showModal();
    try {
      const response = await fetch('/api/profile');
      const profile = await response.json();
      if (!response.ok) throw new Error(profile.error);
      renderProfileGenres(profile.genres || []);
      renderTasteProfile(profile.taste || '');
    } catch (error) {
      elements['taste-content'].textContent = '暂时无法读取用户品味语料。';
    }
  });
  elements['profile-dialog'].addEventListener('click', (event) => {
    if (event.target === elements['profile-dialog']) elements['profile-dialog'].close();
  });

  elements['mic-button'].addEventListener('click', () => {
    if (state.recognition) stopVoiceInput(false);
    else startVoiceInput(false);
  });
  document.addEventListener('keydown', (event) => {
    if (
      event.code !== 'Space'
      || event.metaKey
      || event.ctrlKey
      || event.altKey
      || isEditableTarget(event.target)
    ) return;
    event.preventDefault();
    if (!event.repeat) startVoiceHold();
  });
  document.addEventListener('keyup', (event) => {
    if (event.code !== 'Space' || isEditableTarget(event.target)) return;
    event.preventDefault();
    endVoiceHold();
  });
  elements['message-input'].addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') startVoiceHold();
  });
  window.addEventListener('pointerup', endVoiceHold);
  window.addEventListener('pointercancel', endVoiceHold);
  window.addEventListener('blur', endVoiceHold);
  elements['message-input'].addEventListener('contextmenu', (event) => {
    if (state.voiceHoldTimer || state.voiceHoldActive) event.preventDefault();
  });
}

function registerServiceWorker() {
  if (navigator.userAgent.includes('Electron')) {
    navigator.serviceWorker?.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((item) => item.unregister())))
      .catch(() => {});
    window.caches?.keys()
      .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
      .catch(() => {});
    return;
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function init() {
  cacheElements();
  document.documentElement.classList.toggle(
    'desktop-shell',
    navigator.userAgent.includes('Electron')
  );
  window.AlbumView?.init(() => state, {
    toggle: () => setPlaying(!state.playing),
    select: (index) => selectTrack(index),
    previous: () => selectTrack((state.currentIndex - 1 + state.tracks.length) % state.tracks.length),
    next: () => goToNext(),
    exitFocus: () => setChatFocus(false),
    expandPlayer: () => setPlayerCollapsed(false)
  });
  applyTheme(state.theme);
  setPlayerPinned(state.playerPinned);
  setChatFocus(false);
  renderClock();
  renderProfileGenres(state.genres);
  renderPlayer();
  renderQueue();
  bindEvents();
  loadStation();
  loadSettings().finally(() => window.SwaggerGuide?.initRadio({
    prepare() {
      const collapsed = elements.player.classList.contains('collapsed');
      const focused = state.chatFocus;
      setPlayerCollapsed(false);
      setChatFocus(false);
      return () => {
        setPlayerCollapsed(collapsed);
        setChatFocus(focused);
      };
    }
  }));
  loadAutoplayDirective();
  connectStream();
  refreshIcons();
  registerServiceWorker();
  window.setInterval(renderClock, 1000);
}

document.addEventListener('DOMContentLoaded', init);
