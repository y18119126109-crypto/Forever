let qqMusicLoginHandler = null;
const QQ_MUSIC_COOKIE_NAMES = new Set([
  'uin',
  'wxuin',
  'login_type',
  'euin',
  'qm_keyst',
  'qqmusic_key',
  'psrf_qqopenid',
  'psrf_qqaccess_token',
  'psrf_musickey_createtime',
  'psrf_access_token_expiresAt'
]);
let qqMusicLoginState = {
  available: false,
  active: false,
  status: 'unavailable',
  message: 'QQ 扫码登录仅在桌面应用可用'
};

function snapshot() {
  return { ...qqMusicLoginState };
}

function registerQqMusicLogin(handler) {
  qqMusicLoginHandler = handler;
  qqMusicLoginState = {
    available: true,
    active: false,
    status: 'idle',
    message: '可使用 QQ 音乐官方窗口扫码登录'
  };
}

function serializeQqMusicCookies(cookies = []) {
  const selected = cookies.filter((cookie) =>
    /(^|\.)qq\.com$/i.test(cookie.domain)
    && QQ_MUSIC_COOKIE_NAMES.has(cookie.name)
    && cookie.value
  );
  const values = new Map(selected.map((cookie) => [cookie.name, cookie.value]));
  const hasAccount = values.has('uin') || values.has('wxuin');
  const hasCredential = values.has('qm_keyst')
    || values.has('qqmusic_key')
    || values.has('psrf_qqaccess_token');
  if (!hasAccount || !hasCredential) return '';
  return selected.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function startQqMusicLogin(onCookie) {
  if (!qqMusicLoginHandler) return snapshot();
  if (qqMusicLoginState.active) return snapshot();
  qqMusicLoginState = {
    available: true,
    active: true,
    status: 'waiting',
    message: '请在 QQ 音乐官方窗口完成扫码登录'
  };
  try {
    await qqMusicLoginHandler({
      async complete(cookie) {
        await onCookie(cookie);
        qqMusicLoginState = {
          available: true,
          active: false,
          status: 'success',
          message: 'QQ 音乐登录成功'
        };
      },
      cancel(message = 'QQ 音乐登录窗口已关闭') {
        qqMusicLoginState = {
          available: true,
          active: false,
          status: 'cancelled',
          message
        };
      },
      fail(message = 'QQ 音乐登录失败') {
        qqMusicLoginState = {
          available: true,
          active: false,
          status: 'error',
          message
        };
      }
    });
  } catch (error) {
    qqMusicLoginState = {
      available: true,
      active: false,
      status: 'error',
      message: error.message || 'QQ 音乐登录失败'
    };
  }
  return snapshot();
}

module.exports = {
  getQqMusicLoginStatus: snapshot,
  registerQqMusicLogin,
  serializeQqMusicCookies,
  startQqMusicLogin
};
