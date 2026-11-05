const settings = require('./settings');
const codex = require('./codex');

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    say: { type: 'string' },
    play: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 6
    },
    reason: { type: 'string' },
    segue: { type: 'string' },
    playerAction: {
      type: 'string',
      enum: ['none', 'play', 'pause', 'previous', 'next', 'stop']
    },
    choices: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', maxLength: 40 },
          label: { type: 'string', maxLength: 32 },
          prompt: { type: 'string', maxLength: 300 },
          description: { type: 'string', maxLength: 100 }
        },
        required: ['id', 'label', 'prompt', 'description']
      }
    }
  },
  required: ['say', 'play', 'reason', 'segue', 'playerAction', 'choices']
};

function systemPrompt(assistantName, responseMode = 'direct') {
  const modeInstruction = responseMode === 'interactive'
    ? '当前为互动选择模式。仅当音乐请求的风格、强度或场景明显宽泛时，返回 2 到 4 个 choices，并同时令 play=[]、playerAction="none"；意图明确时 choices=[] 并直接推荐。'
    : responseMode === 'playlist'
      ? '当前为歌单卡片模式。choices 必须为空数组；推荐歌曲仍写入 play，界面会把已解析歌曲显示成临时歌单。'
      : '当前为直接播放模式。choices 必须为空数组，保持直接回答和播放。';
  return `你是私人电台 DJ ${assistantName}。严格输出包含 say、play、reason、segue、playerAction、choices 的 JSON，不要输出额外文本。playerAction 只能是 none、play、pause、previous、next、stop。choices 每项必须包含 id、label、prompt、description，prompt 是用户点击后可直接执行的完整中文音乐约束。${modeInstruction}需要控制播放器时选择对应动作，否则返回 none。能直接执行就直接执行，say 要像自然对话一样简短；不要说“收到”“我会把请求放进节目”“稍后告诉你原因”等流程化套话。`;
}

let blockedUntil = 0;
let lastError = null;
let lastConfigSignature = '';
const REQUEST_TIMEOUT_MS = Math.max(
  10000,
  Math.min(180000, Number(process.env.LLM_TIMEOUT_MS) || 90000)
);

// #region debug-point A-B-C:model-provider
const MODEL_DEBUG_ENDPOINT = process.env.DEBUG_SERVER_URL || 'http://127.0.0.1:7778/event';
function reportModelDebug(hypothesisId, location, msg, data = {}) {
  fetch(MODEL_DEBUG_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'desktop-ark-connection',
      runId: 'post-fix',
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}
// #endregion

function extractJson(value) {
  const source = String(value || '').trim();
  if (!source) throw new Error('The model returned an empty response');
  try {
    return JSON.parse(source);
  } catch (error) {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const object = source.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]);
    throw new Error('The model response did not contain JSON');
  }
}

function extractResponsesText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const texts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') texts.push(content.text);
    }
  }
  return texts.join('\n');
}

async function request(url, options) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    // #region debug-point B-C:model-http-response
    reportModelDebug('B-C', 'src/llm.js:request', 'model provider responded', {
      host: new URL(url).host,
      pathname: new URL(url).pathname,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      errorCode: body.error?.code || body.type || null,
      hasErrorMessage: Boolean(body.error?.message || body.message)
    });
    // #endregion
    if (!response.ok) {
      const error = new Error(
        body.error?.message
        || body.message
        || `Model provider returned ${response.status}`
      );
      error.code = body.error?.code || body.type || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function completeResponses(prompt, config, assistantName) {
  const payload = await request(`${config.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      instructions: systemPrompt(assistantName, config.responseMode),
      input: prompt,
      max_output_tokens: 2400,
      text: {
        format: {
          type: 'json_schema',
          name: 'claudio_dj_response',
          strict: true,
          schema: RESPONSE_SCHEMA
        }
      }
    })
  });
  return {
    value: extractJson(extractResponsesText(payload)),
    requestId: payload.id || null,
    model: payload.model || config.model,
    usage: payload.usage || null
  };
}

async function completeOpenAiCompatible(prompt, config, assistantName) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const payload = await request(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt(assistantName, config.responseMode) },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 900
    })
  });
  return {
    value: extractJson(payload.choices?.[0]?.message?.content),
    requestId: payload.id || null,
    model: payload.model || config.model,
    usage: payload.usage || null
  };
}

async function completeAnthropic(prompt, config, assistantName) {
  const payload = await request(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 900,
      system: systemPrompt(assistantName, config.responseMode),
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const text = (payload.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  return {
    value: extractJson(text),
    requestId: payload.id || null,
    model: payload.model || config.model,
    usage: payload.usage || null
  };
}

async function complete(prompt) {
  const [integrations, preferences] = await Promise.all([
    settings.getRuntimeIntegrations(),
    settings.getSettings()
  ]);
  const config = integrations.ai;
  config.responseMode = preferences.recommendation.responseMode;
  const codexStatus = config.provider === 'codex-cli' ? codex.status() : null;
  const configured = config.provider === 'codex-cli'
    ? Boolean(codexStatus.installed && codexStatus.loggedIn)
    : Boolean(
      config.model
      && (config.apiKey || config.provider === 'openai-compatible')
    );
  // #region debug-point A-C:model-runtime-config
  reportModelDebug('A-C', 'src/llm.js:complete:config', 'resolved model configuration', {
    provider: config.provider,
    baseHost: (() => {
      try {
        return new URL(config.baseUrl).host;
      } catch (error) {
        return '';
      }
    })(),
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyLength: config.apiKey?.length || 0,
    configured
  });
  // #endregion
  if (!configured) {
    const error = config.provider === 'codex-cli'
      ? new Error(codexStatus.installed
        ? 'Codex CLI is not logged in'
        : 'Codex CLI is not installed')
      : new Error(`${config.provider} API key is not configured`);
    error.code = config.provider === 'codex-cli'
      ? codexStatus.errorCode
      : 'MODEL_NOT_CONFIGURED';
    throw error;
  }

  const credentialSignature = config.provider === 'codex-cli'
    ? `${codexStatus.version}:${codexStatus.authMode}`
    : config.apiKey.slice(-4);
  const signature = `${config.provider}:${config.baseUrl}:${config.model}:${credentialSignature}`;
  if (signature !== lastConfigSignature) {
    blockedUntil = 0;
    lastError = null;
    lastConfigSignature = signature;
  }
  if (Date.now() < blockedUntil) {
    const error = new Error(lastError?.message || 'Model provider is temporarily unavailable');
    error.code = lastError?.code || 'MODEL_CIRCUIT_OPEN';
    throw error;
  }

  try {
    let response;
    if (config.provider === 'codex-cli') {
      response = await codex.complete(prompt, config, preferences.assistantName);
    } else if (config.provider === 'anthropic') {
      response = await completeAnthropic(prompt, config, preferences.assistantName);
    } else if (config.provider === 'openai-compatible') {
      response = await completeOpenAiCompatible(prompt, config, preferences.assistantName);
    } else {
      response = await completeResponses(prompt, config, preferences.assistantName);
    }
    lastError = null;
    blockedUntil = 0;
    // #region debug-point B:model-success
    reportModelDebug('B', 'src/llm.js:complete:success', 'model completion succeeded', {
      provider: config.provider,
      requestedModel: config.model,
      responseModel: response.model || null,
      hasRequestId: Boolean(response.requestId),
      hasUsage: Boolean(response.usage)
    });
    // #endregion
    return { ...response, provider: config.provider };
  } catch (error) {
    lastError = { code: error.code, message: error.message };
    // #region debug-point B-C:model-error
    reportModelDebug('B-C', 'src/llm.js:complete:error', 'model completion failed', {
      provider: config.provider,
      model: config.model,
      status: error.status || null,
      code: error.code || null,
      name: error.name || null,
      message: String(error.message || '').slice(0, 300)
    });
    // #endregion
    if (error.status >= 400 && error.status < 500) {
      blockedUntil = Date.now() + 5 * 60 * 1000;
    }
    throw error;
  }
}

async function status() {
  const { ai: config } = await settings.getRuntimeIntegrations();
  if (config.provider === 'codex-cli') {
    const cli = codex.status();
    return {
      configured: Boolean(cli.installed && cli.loggedIn),
      provider: config.provider,
      model: config.model || 'codex-default',
      circuitOpen: Date.now() < blockedUntil,
      lastErrorCode: lastError?.code || cli.errorCode || null,
      cli
    };
  }
  return {
    configured: Boolean(
      config.model
      && (config.apiKey || config.provider === 'openai-compatible')
    ),
    provider: config.provider,
    model: config.model,
    circuitOpen: Date.now() < blockedUntil,
    lastErrorCode: lastError?.code || null
  };
}

module.exports = {
  complete,
  status
};
