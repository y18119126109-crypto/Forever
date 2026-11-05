const { spawn, spawnSync } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const COMMAND = process.env.CODEX_COMMAND || 'codex';
const TIMEOUT_MS = Math.max(
  10000,
  Math.min(300000, Number(process.env.CODEX_TIMEOUT_MS) || 90000)
);
const LOGIN_TIMEOUT_MS = Math.max(
  30000,
  Math.min(10 * 60 * 1000, Number(process.env.CODEX_LOGIN_TIMEOUT_MS) || 300000)
);
const STATUS_CACHE_MS = 10000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

let cachedStatus = null;
let cachedStatusUntil = 0;
let loginPromise = null;

function commandError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function authenticationMode(output) {
  const normalized = String(output || '').toLowerCase();
  if (normalized.includes('chatgpt')) return 'chatgpt';
  if (normalized.includes('api key') || normalized.includes('api-key')) return 'api-key';
  return normalized ? 'authenticated' : 'unknown';
}

function probe(args, timeout = 5000) {
  return spawnSync(COMMAND, args, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: process.env
  });
}

function readStatus() {
  if (process.env.CODEX_DISABLED === '1') {
    return {
      installed: false,
      loggedIn: false,
      disabled: true,
      version: '',
      authMode: 'disabled',
      errorCode: 'CODEX_DISABLED'
    };
  }

  const versionResult = probe(['--version'], 3000);
  if (versionResult.error || versionResult.status !== 0) {
    return {
      installed: false,
      loggedIn: false,
      disabled: false,
      version: '',
      authMode: 'none',
      errorCode: versionResult.error?.code === 'ENOENT'
        ? 'CODEX_NOT_INSTALLED'
        : 'CODEX_UNAVAILABLE'
    };
  }

  const loginResult = probe(['login', 'status']);
  const loginOutput = `${loginResult.stdout || ''}\n${loginResult.stderr || ''}`.trim();
  return {
    installed: true,
    loggedIn: !loginResult.error && loginResult.status === 0,
    disabled: false,
    version: firstLine(versionResult.stdout || versionResult.stderr),
    authMode: loginResult.status === 0 ? authenticationMode(loginOutput) : 'none',
    errorCode: loginResult.status === 0 ? null : 'CODEX_NOT_LOGGED_IN'
  };
}

function status(force = false) {
  if (!force && cachedStatus && Date.now() < cachedStatusUntil) {
    return cachedStatus;
  }
  cachedStatus = readStatus();
  cachedStatusUntil = Date.now() + STATUS_CACHE_MS;
  return cachedStatus;
}

function collectProcess(args, options = {}) {
  const timeoutMs = options.timeoutMs || TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(COMMAND, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        finish(() => reject(commandError('Codex CLI output exceeded 2MB', 'CODEX_OUTPUT_LIMIT')));
        return current;
      }
      return next;
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(commandError(
        `Codex CLI timed out after ${timeoutMs}ms`,
        'CODEX_TIMEOUT'
      )));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => {
      finish(() => {
        if (error.code === 'ENOENT') {
          reject(commandError('Codex CLI is not installed', 'CODEX_NOT_INSTALLED'));
          return;
        }
        reject(error);
      });
    });
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          const message = firstLine(stderr) || firstLine(stdout) || `Codex CLI exited with code ${code}`;
          const authFailure = /login|log in|auth|credential|unauthorized/i.test(`${stderr}\n${stdout}`);
          reject(commandError(
            message,
            authFailure ? 'CODEX_NOT_LOGGED_IN' : 'CODEX_EXEC_FAILED'
          ));
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        finish(() => reject(error));
      }
    });
    child.stdin.end(options.input || '');
  });
}

function extractJson(value) {
  const source = String(value || '').trim();
  if (!source) throw commandError('Codex CLI returned an empty response', 'CODEX_EMPTY_RESPONSE');
  try {
    return JSON.parse(source);
  } catch (error) {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const object = source.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]);
    throw commandError('Codex CLI response did not contain JSON', 'CODEX_INVALID_RESPONSE');
  }
}

function responsePrompt(prompt, assistantName, responseMode = 'direct') {
  const modeInstruction = responseMode === 'interactive'
    ? '互动选择模式：请求明显宽泛时给 2～4 个 choices，并令 play=[]、playerAction="none"；请求明确时直接推荐且 choices=[]。'
    : responseMode === 'playlist'
      ? '歌单卡片模式：choices=[]，推荐歌曲继续写入 play。'
      : '直接播放模式：choices=[]。';
  return [
    `你是私人电台 DJ ${assistantName}。`,
    '不要调用任何工具，不要读取文件，不要解释处理过程。',
    '只输出一个 JSON 对象，不能包含 Markdown 或额外文本。',
    'JSON 必须包含以下字段：',
    '- say: string',
    '- play: string[]，最多 6 项',
    '- reason: string',
    '- segue: string',
    '- playerAction: "none" | "play" | "pause" | "previous" | "next" | "stop"',
    '- choices: {id:string,label:string,prompt:string,description:string}[]，最多 4 项',
    modeInstruction,
    '能直接执行就直接执行，say 要自然简短，不要使用流程化套话。',
    '',
    '电台上下文与用户请求：',
    prompt
  ].join('\n');
}

async function complete(prompt, config, assistantName) {
  const currentStatus = status(true);
  if (!currentStatus.installed) {
    throw commandError('Codex CLI is not installed', 'CODEX_NOT_INSTALLED');
  }
  if (!currentStatus.loggedIn) {
    throw commandError('Codex CLI is not logged in', 'CODEX_NOT_LOGGED_IN');
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-codex-'));
  try {
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only'
    ];
    if (config.model) args.push('--model', config.model);
    args.push('-');

    const result = await collectProcess(args, {
      cwd: temporaryDirectory,
      input: responsePrompt(prompt, assistantName, config.responseMode)
    });
    return {
      value: extractJson(result.stdout),
      requestId: null,
      model: config.model || 'codex-default',
      usage: null
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function login() {
  if (loginPromise) return loginPromise;
  const currentStatus = status(true);
  if (!currentStatus.installed) {
    throw commandError('Codex CLI is not installed', 'CODEX_NOT_INSTALLED');
  }

  loginPromise = collectProcess(['login'], { timeoutMs: LOGIN_TIMEOUT_MS })
    .then(() => {
      cachedStatusUntil = 0;
      const nextStatus = status(true);
      if (!nextStatus.loggedIn) {
        throw commandError('Codex CLI login did not complete', 'CODEX_NOT_LOGGED_IN');
      }
      return nextStatus;
    })
    .finally(() => {
      loginPromise = null;
    });
  return loginPromise;
}

module.exports = {
  complete,
  login,
  status
};
