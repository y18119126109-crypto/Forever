#!/usr/bin/env node

const args = process.argv.slice(2);

if (args[0] === '--version') {
  process.stdout.write('codex-cli 0.test\n');
  process.exit(0);
}

if (args[0] === 'login' && args[1] === 'status') {
  if (process.env.FAKE_CODEX_LOGGED_IN === '1') {
    process.stdout.write('Logged in using ChatGPT\n');
    process.exit(0);
  }
  process.stderr.write('Not logged in\n');
  process.exit(1);
}

if (args[0] === 'login') {
  process.stdout.write('Login successful\n');
  process.exit(0);
}

if (args[0] === 'exec') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    if (!input.includes('playerAction')) {
      process.stderr.write('Missing response contract\n');
      process.exit(2);
    }
    const chatOnly = input.includes('仅聊天测试');
    process.stdout.write(JSON.stringify({
      say: '用 Codex 继续。',
      play: chatOnly ? [] : ['测试歌曲'],
      reason: '模拟 Codex CLI 响应。',
      segue: '',
      playerAction: chatOnly ? 'none' : 'play'
    }));
  });
  return;
}

process.stderr.write(`Unsupported fake Codex command: ${args.join(' ')}\n`);
process.exit(2);
