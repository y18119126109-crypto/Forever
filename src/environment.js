const DEFAULT_LOCATION = {
  city: process.env.CLAUDIO_CITY || '上海',
  latitude: Number(process.env.CLAUDIO_LATITUDE || 31.2304),
  longitude: Number(process.env.CLAUDIO_LONGITUDE || 121.4737)
};

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`Environment API returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getWeather() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      city: DEFAULT_LOCATION.city,
      summary: '天气服务未配置',
      temperature: null
    };
  }

  try {
    const query = new URLSearchParams({
      lat: String(DEFAULT_LOCATION.latitude),
      lon: String(DEFAULT_LOCATION.longitude),
      appid: apiKey,
      units: 'metric',
      lang: 'zh_cn'
    });
    const data = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?${query}`);
    return {
      configured: true,
      city: data.name || DEFAULT_LOCATION.city,
      summary: data.weather?.[0]?.description || '未知',
      temperature: Math.round(data.main?.temp)
    };
  } catch (error) {
    return {
      configured: true,
      city: DEFAULT_LOCATION.city,
      summary: '天气服务暂时不可用',
      temperature: null
    };
  }
}

async function getCalendar() {
  const endpoint = process.env.CALENDAR_CONTEXT_URL;
  if (!endpoint) return { configured: false, events: [] };
  try {
    const data = await fetchJson(endpoint, {
      Authorization: process.env.CALENDAR_CONTEXT_TOKEN
        ? `Bearer ${process.env.CALENDAR_CONTEXT_TOKEN}`
        : ''
    });
    return {
      configured: true,
      events: Array.isArray(data.events) ? data.events.slice(0, 8) : []
    };
  } catch (error) {
    return { configured: true, events: [], error: 'calendar_unavailable' };
  }
}

async function getEnvironment() {
  const [weather, calendar] = await Promise.all([getWeather(), getCalendar()]);
  const now = new Date();
  return {
    now: now.toISOString(),
    localTime: now.toLocaleTimeString('zh-CN', { hour12: false }),
    weekday: now.toLocaleDateString('zh-CN', { weekday: 'long' }),
    period: now.getHours() >= 22 || now.getHours() < 6 ? '深夜' : now.getHours() < 12 ? '上午' : '下午',
    weather,
    calendar
  };
}

module.exports = {
  getEnvironment,
  getWeather,
  getCalendar
};
