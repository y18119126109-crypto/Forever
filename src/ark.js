const BASE_URL = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3')
  .replace(/\/$/, '');
const API_KEY = process.env.ARK_API_KEY || '';
const MODEL = process.env.ARK_MODEL || 'doubao-seed-2-1-pro-260915';

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
    segue: { type: 'string' }
  },
  required: ['say', 'play', 'reason', 'segue']
};

let blockedUntil = 0;
let lastError = null;

function extractOutput(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const texts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') texts.push(content.text);
    }
  }
  return texts.join('\n');
}

async function request(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || `Ark returned ${response.status}`);
      error.code = body.error?.code || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function complete(prompt) {
  if (!API_KEY) throw new Error('ARK_API_KEY is not configured');
  if (Date.now() < blockedUntil) {
    const error = new Error(lastError?.message || 'Ark is temporarily unavailable');
    error.code = lastError?.code || 'ARK_CIRCUIT_OPEN';
    throw error;
  }

  try {
    const payload = await request('/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL,
        instructions: '你是私人 AI 电台 DJ。严格按照 JSON Schema 输出，不要输出额外文本。',
        input: prompt,
        max_output_tokens: 900,
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
    const output = extractOutput(payload);
    if (!output) throw new Error('Ark returned no text output');
    lastError = null;
    blockedUntil = 0;
    return {
      value: JSON.parse(output),
      requestId: payload.id || null,
      model: payload.model || MODEL,
      usage: payload.usage || null
    };
  } catch (error) {
    lastError = { code: error.code, message: error.message };
    if (error.status >= 400 && error.status < 500) {
      blockedUntil = Date.now() + 5 * 60 * 1000;
    }
    throw error;
  }
}

async function listModels() {
  if (!API_KEY) return [];
  const payload = await request('/models', { method: 'GET' });
  return Array.isArray(payload.data) ? payload.data : [];
}

function status() {
  return {
    configured: Boolean(API_KEY),
    model: MODEL,
    circuitOpen: Date.now() < blockedUntil,
    lastErrorCode: lastError?.code || null
  };
}

module.exports = {
  complete,
  listModels,
  status,
  isConfigured: Boolean(API_KEY),
  model: MODEL
};
