const DEFAULT_SCHEDULE = [
  { time: '07:00', title: '醒来电台', prompt: '规划今天早晨的活力歌单' },
  { time: '09:00', title: '专注信号', prompt: '切换到低干扰的工作音乐' },
  { time: '12:00', title: '午间留白', prompt: '播放适合午休的轻松音乐' },
  { time: '18:00', title: '下班转换', prompt: '从工作状态过渡到下班音乐' },
  { time: '23:00', title: '夜间收束', prompt: '播放白噪音或助眠音乐' }
];

function localMinute(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function initScheduler(onTrigger = () => {}, schedule = DEFAULT_SCHEDULE) {
  let lastTrigger = '';

  const tick = async () => {
    const now = new Date();
    const minute = localMinute(now);
    const key = `${now.toDateString()} ${minute}`;
    if (lastTrigger === key) return;
    const entry = schedule.find((item) => item.time === minute);
    if (!entry) return;
    lastTrigger = key;
    try {
      await onTrigger({ ...entry, triggeredAt: now.toISOString() });
    } catch (error) {
      console.error('[scheduler]', error.message);
    }
  };

  const interval = setInterval(tick, 30000);
  tick();
  return () => clearInterval(interval);
}

module.exports = {
  initScheduler,
  schedule: DEFAULT_SCHEDULE
};
