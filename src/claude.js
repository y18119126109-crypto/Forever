const { spawn, spawnSync } = require('child_process');
const { buildContext } = require('./context');
const llm = require('./llm');

const COMMAND = process.env.CLAUDE_COMMAND || 'claude';
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 45000);
const probe = spawnSync(COMMAND, ['--version'], {
  encoding: 'utf8',
  timeout: 3000,
  stdio: 'ignore'
});
const CLI_AVAILABLE = !probe.error && probe.status === 0;
const PLAYER_ACTIONS = new Set(['none', 'play', 'pause', 'previous', 'next', 'stop']);

function extractJson(value) {
  if (value && typeof value === 'object') return value;
  const source = String(value || '').trim();
  if (!source) throw new Error('Claude returned an empty response');

  try {
    return JSON.parse(source);
  } catch (error) {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const object = source.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]);
    throw new Error('Claude response did not contain JSON');
  }
}

function normalizeResponse(payload) {
  let value = payload;
  if (payload?.result) value = extractJson(payload.result);
  if (payload?.content && typeof payload.content === 'string') value = extractJson(payload.content);
  if (!value || typeof value !== 'object') throw new Error('Invalid Claude response');

  const seenChoices = new Set();
  const choices = (Array.isArray(value.choices) ? value.choices : [])
    .slice(0, 4)
    .map((choice, index) => {
      if (!choice || typeof choice !== 'object') return null;
      const label = String(choice.label || '').trim().slice(0, 32);
      const prompt = String(choice.prompt || '').trim().slice(0, 300);
      const description = String(choice.description || '').trim().slice(0, 100);
      let id = String(choice.id || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      if (!id) id = `choice-${index + 1}`;
      if (!label || !prompt || seenChoices.has(id)) return null;
      seenChoices.add(id);
      return { id, label, prompt, description };
    })
    .filter(Boolean);
  return {
    say: String(value.say || ''),
    play: Array.isArray(value.play) ? value.play.map(String).slice(0, 6) : [],
    reason: String(value.reason || ''),
    segue: String(value.segue || ''),
    playerAction: PLAYER_ACTIONS.has(value.playerAction) ? value.playerAction : 'none',
    choices
  };
}

function inferPlayerAction(userInput) {
  if (/上一首|前一首|previous/i.test(userInput)) return 'previous';
  if (/下一首|换一首|切歌|next/i.test(userInput)) return 'next';
  if (/暂停|pause/i.test(userInput)) return 'pause';
  if (/停止|关掉音乐|stop/i.test(userInput)) return 'stop';
  if (/继续播放|恢复播放|开始播放|播放音乐|play/i.test(userInput)) return 'play';
  return 'none';
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(COMMAND, ['-p', '--output-format', 'json'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Claude timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Claude exited with code ${code}`));
        return;
      }
      try {
        resolve(normalizeResponse(extractJson(stdout)));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(`${prompt}\n\n只输出约定的 JSON，不要输出 Markdown。`);
  });
}

function fallbackResponse(userInput) {
  const playerAction = inferPlayerAction(userInput);
  if (/为什么|原因/.test(userInput)) {
    return {
      say: '因为这个时段更适合动态克制、留白充足的音乐。我也参考了你的作息和最近播放记录，让声音不会突然打断正在发生的事。',
      play: ['If Bread'],
      reason: '时段、用户品味和历史播放记录共同决定。',
      segue: '先把音量留在这里，听完下一段吉他。',
      playerAction,
      choices: []
    };
  }

  const quiet = /安静|放松|睡|轻/.test(userInput);
  const focus = /专注|工作|学习/.test(userInput);
  const musicRequest = /听|歌|音乐|播放|来一首|推荐/.test(userInput);
  return {
    say: quiet
      ? '好，先把声音放轻一点。'
      : focus
        ? '接下来少一点人声，让节奏稳稳托住注意力。'
        : musicRequest ? '好，直接放。' : '我在。',
    play: quiet
      ? ['If Bread', 'Ambient Rain']
      : focus
        ? ['Lo-Fi Focus', 'Instrumental Jazz']
        : musicRequest ? [userInput] : [],
    reason: '本地规则引擎根据请求关键词、时段和用户语料生成。',
    segue: '',
    playerAction,
    choices: []
  };
}

async function compute(userInput, options = {}) {
  const context = await buildContext({
    userInput,
    toolResult: options.toolResult,
    actionTrail: options.actionTrail
  });

  const llmStatus = await llm.status();
  if (llmStatus.configured) {
    try {
      const response = await llm.complete(context.prompt);
      return {
        ...normalizeResponse(response.value),
        provider: response.provider,
        model: response.model,
        requestId: response.requestId,
        usage: response.usage
      };
    } catch (error) {
      if (process.env.CLAUDE_DISABLED === '1' || !CLI_AVAILABLE) {
        return {
          ...fallbackResponse(userInput),
          provider: 'local-rules',
          providerError: error.code || 'ark_unavailable'
        };
      }
    }
  }

  if (process.env.CLAUDE_DISABLED === '1' || !CLI_AVAILABLE) {
    return { ...fallbackResponse(userInput), provider: 'local-rules' };
  }

  try {
    const response = await runClaude(context.prompt);
    return { ...response, provider: 'claude-cli' };
  } catch (error) {
    return {
      ...fallbackResponse(userInput),
      provider: 'local-rules',
      providerError: error.code === 'ENOENT' ? 'claude_not_installed' : 'claude_unavailable'
    };
  }
}

module.exports = {
  isAvailable: CLI_AVAILABLE,
  compute,
  runClaude,
  normalizeResponse
};
