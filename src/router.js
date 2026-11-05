const claude = require('./claude');
const llm = require('./llm');
const music = require('./music');
const state = require('./state');
const settings = require('./settings');
const AUTOPLAY_DIRECTIVE_KEY = 'autoplay_directive';
const AMBIENT_AUDIO_PATTERN =
  /(白噪音|雨|海浪|水声|溪流|森林|鸟叫|虫鸣|篝火|壁炉|风声|雷声|环境|自然|助眠|睡眠|冥想|ASMR)/i;

function directPlayerAction(input) {
  const text = input.trim().replace(/[。！!？?，,\s]/g, '');
  const commands = [
    { action: 'previous', pattern: /^(请|帮我|麻烦)?(播放|切到)?(上一首|前一首)(歌)?$/ },
    { action: 'next', pattern: /^(请|帮我|麻烦)?(播放|切到|换)?(下一首|后一首)(歌)?$/ },
    { action: 'pause', pattern: /^(请|帮我|麻烦)?暂停(一下|播放|音乐)?$/ },
    { action: 'stop', pattern: /^(请|帮我|麻烦)?(停止|关掉)(播放|音乐)?$/ },
    { action: 'play', pattern: /^(请|帮我|麻烦)?(继续|恢复|开始)?播放(当前歌曲|音乐)?$/ }
  ];
  return commands.find((command) => command.pattern.test(text))?.action || 'none';
}

function controlResponse(playerAction) {
  const copy = {
    play: '继续播放。',
    pause: '已暂停。',
    previous: '回到上一首。',
    next: '切到下一首。',
    stop: '播放已停止。'
  };
  return {
    type: 'control',
    action: playerAction,
    playerAction,
    say: copy[playerAction],
    play: [],
    reason: '根据你的播放控制指令执行。',
    segue: ''
  };
}

function chineseNumber(value) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  if (value === '半') return 0.5;
  const digits = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  if (digits[value]) return digits[value];
  const match = value.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (!match) return null;
  return (digits[match[1]] || 1) * 10 + (digits[match[2]] || 0);
}

function directiveDurationMinutes(text) {
  const match = text.match(
    /([0-9]+(?:\.[0-9]+)?|半|[一二两三四五六七八九十]+)\s*个?\s*(小时|分钟)/
  );
  if (!match) return 120;
  const amount = chineseNumber(match[1]);
  if (!Number.isFinite(amount)) return 120;
  const minutes = match[2] === '小时' ? amount * 60 : amount;
  return Math.max(15, Math.min(24 * 60, Math.round(minutes)));
}

function parseAutoplayDirective(input, now = Date.now()) {
  const text = String(input || '').trim();
  if (
    /恢复(默认|普通).*(推荐|歌单)|取消.*(临时|当前).*(推荐|指令)|不再.*(白噪音|雨声|环境音)/.test(text)
  ) {
    return { clear: true };
  }
  const hasAudioSubject =
    /(白噪音|雨声|海浪|环境音|自然声|音乐|歌曲|歌|爵士|民谣|摇滚|古典|纯音乐|电子|嘻哈|说唱|lo-?fi|轻音乐|助眠|专注)/i.test(text);
  const hasTimeScope =
    /(接下来|未来|近|这段时间|暂时|后续|一会儿|今天)/.test(text)
    || /(?:小时|分钟)/.test(text)
    || /多来(一些|点)?/.test(text);
  const hasDirective = /(都|只|多来|改成|保持|播放|听|安排|换成|为主)/.test(text);
  if (!hasAudioSubject || !hasTimeScope || !hasDirective) return null;

  const durationMinutes = directiveDurationMinutes(text);
  return {
    instruction: text.slice(0, 500),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + durationMinutes * 60 * 1000).toISOString(),
    durationMinutes,
    strategy: 'ai-first'
  };
}

async function getActiveAutoplayDirective(now = Date.now()) {
  const directive = await state.getPref(AUTOPLAY_DIRECTIVE_KEY, null);
  if (!directive?.instruction || Date.parse(directive.expiresAt) <= now) {
    if (directive) await state.setPref(AUTOPLAY_DIRECTIVE_KEY, null);
    return null;
  }
  return directive;
}

async function setAutoplayDirective(instruction, durationMinutes = 120, now = Date.now()) {
  const text = String(instruction || '').trim().slice(0, 500);
  if (!text) throw new Error('A directive instruction is required');
  const duration = Math.max(
    15,
    Math.min(24 * 60, Math.round(Number(durationMinutes) || 120))
  );
  const directive = {
    instruction: text,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + duration * 60 * 1000).toISOString(),
    durationMinutes: duration,
    strategy: 'ai-first'
  };
  await state.setPref(AUTOPLAY_DIRECTIVE_KEY, directive);
  return directive;
}

async function clearAutoplayDirective() {
  await state.setPref(AUTOPLAY_DIRECTIVE_KEY, null);
}

async function updateAutoplayDirective(input) {
  const parsed = parseAutoplayDirective(input);
  if (!parsed) return getActiveAutoplayDirective();
  if (parsed.clear) {
    await clearAutoplayDirective();
    return null;
  }
  return setAutoplayDirective(
    parsed.instruction,
    parsed.durationMinutes,
    Date.parse(parsed.createdAt)
  );
}

function directiveFallbackQueries(instruction) {
  if (/白噪音/.test(instruction)) {
    return [
      '白噪音 雨声',
      '白噪音 海浪',
      '白噪音 森林',
      '白噪音 篝火',
      '白噪音 咖啡馆',
      '白噪音 雷雨',
      '白噪音 溪流',
      '白噪音 风声',
      '白噪音 虫鸣',
      '白噪音 空调',
      '白噪音 火车',
      '白噪音 飞机'
    ];
  }
  if (/雨声/.test(instruction)) {
    return ['雨声 助眠', '雨声 白噪音', '屋檐雨声', '森林雨声', '雷雨声', '夜晚雨声'];
  }
  return [];
}

function trackMatchesDirective(track, directive) {
  if (!directive?.instruction) return true;
  const instruction = directive.instruction;
  if (!/(白噪音|雨声|海浪|环境音|自然声|助眠)/.test(instruction)) return true;
  const metadata = `${track?.title || ''} ${track?.artist || ''} ${track?.album || ''}`;
  return AMBIENT_AUDIO_PATTERN.test(metadata);
}

function mergeUniqueTracks(...groups) {
  const seen = new Set();
  return groups.flat().filter((track) => {
    const id = String(track?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function resolveDirectiveFallback(directive, excludeIds = [], limit = 6) {
  const queries = directiveFallbackQueries(directive?.instruction || '');
  if (!queries.length || limit <= 0) return [];
  try {
    return await music.resolveSearchPool(
      queries,
      limit,
      excludeIds,
      AMBIENT_AUDIO_PATTERN
    );
  } catch (error) {
    return [];
  }
}

function directiveSearchConstraint(instruction) {
  if (/白噪音/.test(instruction)) {
    return '每个 play 搜索词必须显式包含“白噪音”或雨声、海浪、森林、篝火、咖啡馆、雷雨等环境声关键词。';
  }
  return '';
}

async function computeDirectiveQueue(prompt, player, excludeIds) {
  try {
    const response = await llm.complete(
      `${prompt}\n\n当前播放器：${JSON.stringify(player || null)}\n排除歌曲 ID：${JSON.stringify(excludeIds.slice(-50))}`
    );
    return {
      ...claude.normalizeResponse(response.value),
      provider: response.provider,
      model: response.model,
      requestId: response.requestId,
      usage: response.usage
    };
  } catch (error) {
    return null;
  }
}

async function routeIntent(input, options = {}) {
  const text = input.trim();

  if (text.startsWith('/play ')) {
    const query = text.slice(6).trim();
    const track = await music.resolve(query);
    if (!track) {
      return {
        type: 'music',
        action: 'not-found',
        playerAction: 'none',
        say: `没有找到“${query}”。`
      };
    }
    await state.addPlay(track.id, track.title);
    return {
      type: 'music',
      action: 'play',
      playerAction: 'play',
      say: `现在播放 ${track.title}，来自 ${track.artist}。`,
      queue: [track]
    };
  }

  if (text === '/stop') {
    return {
      type: 'music',
      action: 'stop',
      playerAction: 'stop',
      say: '播放已停止。'
    };
  }

  const playerAction = directPlayerAction(text);
  if (playerAction !== 'none') return controlResponse(playerAction);

  await state.addMessage('user', text);
  const currentSettings = await settings.getSettings();
  const responseMode = currentSettings.recommendation.responseMode;
  const parsedDirective = parseAutoplayDirective(text);
  const autoplayDirective = await updateAutoplayDirective(text);
  let response;
  if (parsedDirective?.instruction) {
    const prompt =
      `用户刚设置临时节目指令：“${parsedDirective.instruction}”。立即给出 6 个彼此不同、可搜索播放且严格符合指令的音频。${directiveSearchConstraint(parsedDirective.instruction)}say 用一句自然中文确认，play 必须正好 6 项，playerAction 必须为 play。`;
    response = await computeDirectiveQueue(prompt, options.player, []);
    response ||= {
      say: '接下来换成白噪音。',
      play: directiveFallbackQueries(parsedDirective.instruction),
      reason: '临时节目指令优先。',
      segue: '',
      playerAction: 'play',
      provider: 'local-rules'
    };
  } else {
    response = await claude.compute(text, {
      toolResult: {
        player: options.player || null,
        external: options.toolResult || null,
        autoplayDirective
      },
      actionTrail: options.actionTrail || []
    });
  }
  const choices = responseMode === 'interactive' && !parsedDirective?.instruction
    ? (response.choices || [])
    : [];
  if (choices.length) {
    response = {
      ...response,
      play: [],
      playerAction: 'none',
      choices
    };
  } else {
    response = { ...response, choices: [] };
  }
  let queue = response.play.length
    ? await music.resolveQueue(response.play)
    : [];
  if (parsedDirective?.instruction) {
    const matchingQueue = queue.filter(
      (track) => trackMatchesDirective(track, autoplayDirective)
    );
    const directiveFallback = await resolveDirectiveFallback(
      autoplayDirective,
      [],
      6 - matchingQueue.length
    );
    queue = mergeUniqueTracks(
      matchingQueue,
      directiveFallback
    ).slice(0, 6);
  }
  const result = {
    ...response,
    queue,
    responseMode,
    autoplayDirective,
    playerAction: parsedDirective?.instruction && queue.length
      ? 'play'
      : response.playerAction
  };
  await state.addMessage('assistant', JSON.stringify(result));
  return { type: 'chat', data: result };
}

async function continueQueue(options = {}) {
  const excludeIds = Array.isArray(options.excludeIds)
    ? options.excludeIds.map(String).slice(-300)
    : [];
  const autoplayDirective = await getActiveAutoplayDirective();
  const localPlays = autoplayDirective ? [] : await state.getUniquePlays(300);
  const listeningHistory = autoplayDirective
    ? []
    : await music.listeningHistory(localPlays, 300);
  const heardIds = listeningHistory.map((track) => String(track.id));
  const currentSettings = await settings.getSettings();
  const familiarRate = currentSettings.recommendation.familiarRate;
  const familiarTarget = autoplayDirective
    ? 0
    : Math.max(0, Math.min(6, Math.round((6 * familiarRate) / 100)));
  const discoveryTarget = 6 - familiarTarget;
  const familiarSummary = listeningHistory.slice(0, 30).map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist
  }));
  let response = null;
  let aiQueue = [];

  const continuationPrompt = autoplayDirective
    ? `最高优先级临时节目指令：“${autoplayDirective.instruction}”。为接下来的自动续播规划 6 个彼此不同、可搜索播放且严格符合该指令的音频；临时忽略常规熟悉歌曲比例与通用推荐。${directiveSearchConstraint(autoplayDirective.instruction)}play 必须正好包含 6 项，playerAction 必须为 none，不解释流程。`
    : `自动续播任务：规划 6 首自然衔接的歌曲。推荐结构为 ${familiarTarget} 首用户听过的熟悉歌曲，加 ${discoveryTarget} 首历史中没有出现过的新歌；不要重复当前队列。只规划歌曲，不解释流程，playerAction 必须为 none。`;
  const aiTask = autoplayDirective
    ? computeDirectiveQueue(continuationPrompt, options.player, excludeIds)
    : claude.compute(
      continuationPrompt,
      {
        toolResult: {
          player: options.player || null,
          excludeIds,
          familiarSongs: familiarSummary,
          targetMix: {
            familiar: familiarTarget,
            discovery: discoveryTarget
          },
          autoplayDirective
        },
        actionTrail: [
          'autoplay-continuation',
          ...(autoplayDirective ? ['temporary-directive-ai-first'] : [])
        ]
      }
    ).catch(() => null);
  response = autoplayDirective
    ? await aiTask
    : await Promise.race([
      aiTask,
      new Promise((resolve) => setTimeout(() => resolve(null), 18000))
    ]);

  try {
    if (response?.provider !== 'local-rules' && response?.play?.length) {
      aiQueue = await music.resolveQueue(response.play);
      if (autoplayDirective) {
        aiQueue = aiQueue.filter((track) => trackMatchesDirective(track, autoplayDirective));
      }
    }
  } catch (error) {
    aiQueue = [];
  }

  const directiveFallback = autoplayDirective
    ? await resolveDirectiveFallback(
      autoplayDirective,
      excludeIds,
      6 - aiQueue.length
    )
    : [];
  const finalQueue = await music.recommendationQueue(6, excludeIds, {
    heardIds,
    familiarTracks: listeningHistory,
    discoveryTracks: [...aiQueue, ...directiveFallback],
    currentId: options.player?.current?.id,
    familiarTarget,
    preferDiscoveryTracks: Boolean(autoplayDirective),
    ignoreHeardForDiscovery: Boolean(autoplayDirective),
    strictDiscoveryTracks: Boolean(autoplayDirective)
  });
  const specialIndex = autoplayDirective ? -1 : finalQueue.findIndex(
    (track, index) => index >= 2 && track.recommendationType === 'discovery'
  );
  if (specialIndex >= 0) finalQueue[specialIndex] = { ...finalQueue[specialIndex], special: true };
  const mix = finalQueue.reduce((counts, track) => {
    const type = track.recommendationType === 'familiar' ? 'familiar' : 'discovery';
    counts[type] += 1;
    return counts;
  }, { familiar: 0, discovery: 0 });
  const aiIds = new Set(aiQueue.map((track) => String(track.id)));
  const aiTrackCount = finalQueue.filter((track) => aiIds.has(String(track.id))).length;

  return {
    queue: finalQueue,
    provider: response?.provider || 'netease',
    reason: response?.reason
      || (autoplayDirective
        ? `临时遵循节目指令：${autoplayDirective.instruction}`
        : `按 ${familiarRate}% 熟悉歌曲比例自动续播。`),
    mix,
    familiarRate: autoplayDirective ? null : familiarRate,
    strategy: autoplayDirective ? 'directive-ai-first' : 'balanced',
    aiTrackCount,
    autoplayDirective
  };
}

async function introduceTrack(track, options = {}) {
  const title = String(track?.title || '').trim().slice(0, 200);
  const artist = String(track?.artist || '').trim().slice(0, 200);
  if (!title) return { say: '', provider: 'none' };

  const fallback = `${artist ? `${artist} 的` : ''}《${title}》，这一首值得留意。`;
  try {
    const response = await claude.compute(
      `自动串场任务：即将播放${artist ? `${artist} 的` : ''}《${title}》。用一句简短、自然、有信息量的中文介绍它，不要说“收到”，不要解释推荐流程。play 必须为空数组，playerAction 必须为 none。`,
      {
        toolResult: {
          player: options.player || null,
          track
        },
        actionTrail: ['special-track-intro']
      }
    );
    return {
      say: response.provider === 'local-rules' || !response.say ? fallback : response.say,
      provider: response.provider
    };
  } catch (error) {
    return { say: fallback, provider: 'local-rules' };
  }
}

module.exports = {
  routeIntent,
  continueQueue,
  introduceTrack,
  parseAutoplayDirective,
  getActiveAutoplayDirective,
  setAutoplayDirective,
  clearAutoplayDirective
};
