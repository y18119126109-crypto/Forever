const assert = require('node:assert/strict');
const test = require('node:test');

const claude = require('../src/claude');

test('keeps valid interactive choices and removes unsafe or duplicate values', () => {
  const response = claude.normalizeResponse({
    say: '你更想听哪一种？',
    play: [],
    reason: '请求范围较宽。',
    segue: '',
    playerAction: 'none',
    choices: [
      {
        id: 'rock',
        label: '高能摇滚',
        prompt: '推荐高能摇滚，鼓点强烈但不要金属。',
        description: '吉他与现场感'
      },
      {
        id: 'rock',
        label: '重复项',
        prompt: '不应保留',
        description: ''
      },
      {
        id: '<electro>',
        label: '工业电子',
        prompt: '推荐冷硬、有冲击力的工业电子。',
        description: '机械节拍'
      },
      {
        id: 'empty',
        label: '',
        prompt: '',
        description: ''
      }
    ]
  });

  assert.deepEqual(response.choices, [
    {
      id: 'rock',
      label: '高能摇滚',
      prompt: '推荐高能摇滚，鼓点强烈但不要金属。',
      description: '吉他与现场感'
    },
    {
      id: 'electro',
      label: '工业电子',
      prompt: '推荐冷硬、有冲击力的工业电子。',
      description: '机械节拍'
    }
  ]);
});
