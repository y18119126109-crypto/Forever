const os = require('os');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, session, shell } = require('electron');
const desktopActions = require('../src/desktop-actions');
const desktopNavigation = require('../src/desktop-navigation');

app.setName('Forever');
// Keep the installer identity and existing profile so rebranding does not reset
// credentials, uploads, listening history or browser preferences.
app.setAppUserModelId('com.swagger.airadio');
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const legacyData = path.join(app.getPath('appData'), 'Swagger AI Radio');
  const foreverData = path.join(app.getPath('appData'), 'Forever');
  app.setPath('userData', fs.existsSync(path.join(legacyData, 'state.db')) ? legacyData : foreverData);
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// #region debug-point D:isolated-desktop-instance
const gotSingleInstanceLock = process.env.SWAGGER_DEBUG_INSTANCE === '1'
  || app.requestSingleInstanceLock();
// #endregion
const DESKTOP_PORT = Math.max(
  1024,
  Math.min(65535, Number(process.env.SWAGGER_DESKTOP_PORT) || 18473)
);

let mainWindow = null;
let serverController = null;
let quitting = false;
let appOrigin = '';
let qqMusicLoginWindow = null;

function extendCommandPath() {
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(home, 'AppData', 'Roaming', 'npm')
    ]
    : [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.local', 'bin')
    ];
  process.env.PATH = [...new Set([
    ...candidates.filter(Boolean),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  ])].join(path.delimiter);
}

async function startLocalService() {
  if (appOrigin) return appOrigin;
  process.env.SWAGGER_DESKTOP = '1';
  process.env.SWAGGER_DATA_DIR = app.getPath('userData');
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(DESKTOP_PORT);
  extendCommandPath();

  const paths = require('../src/paths');
  await paths.ensureDataLayout();
  const serverModule = require('../src/server');
  let runtime;
  try {
    runtime = await serverModule.startServer({
      host: '127.0.0.1',
      port: DESKTOP_PORT
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    runtime = await serverModule.startServer({
      host: '127.0.0.1',
      port: 0
    });
  }
  serverController = serverModule;
  appOrigin = runtime.url;
  return runtime.url;
}

function isLocalUrl(value) {
  try {
    return new URL(value).origin === appOrigin;
  } catch (error) {
    return false;
  }
}

function configurePermissions() {
  const allowLocalMedia = (webContents, permission, callback, details = {}) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(permission === 'media' && isLocalUrl(requestingUrl));
  };
  session.defaultSession.setPermissionRequestHandler(allowLocalMedia);
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      permission === 'media' && isLocalUrl(requestingOrigin || webContents.getURL())
  );
}

function navigateMainWindow(targetUrl) {
  const targetWindow = mainWindow;
  if (!targetWindow || targetWindow.isDestroyed()) return;
  setImmediate(() => {
    if (targetWindow.isDestroyed()) return;
    void targetWindow.loadURL(targetUrl).catch((error) => {
      if (!desktopNavigation.isNavigationAbort(error)) {
        console.error(`[desktop-navigation] ${error.message}`);
      }
    });
  });
}

async function qqMusicCookie(authSession) {
  const cookies = await authSession.cookies.get({});
  return desktopActions.serializeQqMusicCookies(cookies);
}

async function openQqMusicLogin({ complete, cancel, fail }) {
  if (qqMusicLoginWindow && !qqMusicLoginWindow.isDestroyed()) {
    qqMusicLoginWindow.show();
    qqMusicLoginWindow.focus();
    return;
  }

  const authSession = session.fromPartition('persist:swagger-qqmusic-login');
  await authSession.clearStorageData({ storages: ['cookies'] });
  let settled = false;
  let checking = false;
  let timer = null;

  const finish = async (type, value) => {
    if (settled) return;
    settled = true;
    if (timer) clearInterval(timer);
    try {
      if (type === 'complete') await complete(value);
      else if (type === 'fail') fail(value);
      else cancel(value);
    } finally {
      if (qqMusicLoginWindow && !qqMusicLoginWindow.isDestroyed()) {
        qqMusicLoginWindow.close();
      }
    }
  };

  qqMusicLoginWindow = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#111514',
    title: 'QQ 音乐扫码登录',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:swagger-qqmusic-login',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  qqMusicLoginWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (/(^|\.)qq\.com$/i.test(new URL(url).hostname)) {
        qqMusicLoginWindow.loadURL(url);
      } else {
        shell.openExternal(url);
      }
    } catch (error) {
      void finish('fail', 'QQ 音乐登录地址无效');
    }
    return { action: 'deny' };
  });
  qqMusicLoginWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (/(^|\.)qq\.com$/i.test(new URL(targetUrl).hostname)) return;
    } catch (error) {
      // Invalid navigation is blocked below.
    }
    event.preventDefault();
  });
  qqMusicLoginWindow.webContents.on('did-finish-load', () => {
    qqMusicLoginWindow?.webContents.executeJavaScript(`
      document.querySelector('.top_login__link, .js_login, [data-stat="y_new.top.login"]')?.click();
    `).catch(() => {});
  });
  qqMusicLoginWindow.once('ready-to-show', () => qqMusicLoginWindow?.show());
  qqMusicLoginWindow.on('closed', () => {
    qqMusicLoginWindow = null;
    if (!settled) finish('cancel', 'QQ 音乐登录窗口已关闭');
  });

  timer = setInterval(async () => {
    if (checking || settled) return;
    checking = true;
    try {
      const cookie = await qqMusicCookie(authSession);
      if (cookie) await finish('complete', cookie);
    } catch (error) {
      await finish('fail', error.message || '无法读取 QQ 音乐登录状态');
    } finally {
      checking = false;
    }
  }, 1000);
  timer.unref?.();
  setTimeout(() => {
    if (!settled) finish('cancel', 'QQ 音乐登录已超时，请重新扫码');
  }, 5 * 60 * 1000).unref?.();

  await qqMusicLoginWindow.loadURL('https://y.qq.com/n/ryqq/profile');
}

async function createWindow() {
  const url = await startLocalService();
  configurePermissions();
  await session.defaultSession.clearStorageData({
    origin: url,
    storages: ['serviceworkers', 'cachestorage']
  }).catch(() => {});
  await session.defaultSession.clearCache().catch(() => {});

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 390,
    minHeight: 680,
    show: false,
    backgroundColor: '#070a0a',
    title: 'Forever',
    icon: path.join(__dirname, process.platform === 'win32' ? '../build/icon.ico' : '../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isLocalUrl(targetUrl)) {
      navigateMainWindow(targetUrl);
    } else if (/^https?:/i.test(targetUrl)) {
      shell.openExternal(targetUrl);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isLocalUrl(targetUrl)) return;
    event.preventDefault();
    if (/^https?:/i.test(targetUrl)) shell.openExternal(targetUrl);
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  try {
    await mainWindow.loadURL(url);
  } catch (error) {
    const currentUrl = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.webContents.getURL()
      : '';
    if (!desktopNavigation.canIgnoreLocalNavigationAbort(error, currentUrl, isLocalUrl)) {
      throw error;
    }
  }
}

desktopActions.registerQqMusicLogin(openQqMusicLogin);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady()
    .then(createWindow)
    .catch((error) => {
      dialog.showErrorBox(
        'Forever 无法启动',
        error?.stack || error?.message || String(error)
      );
      app.quit();
    });

  app.on('activate', () => {
    if (!mainWindow) {
      createWindow().catch((error) => {
        dialog.showErrorBox('Forever 无法启动', error.message);
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting || !serverController) return;
    event.preventDefault();
    quitting = true;
    serverController.stopServer()
      .catch(() => {})
      .finally(() => app.quit());
  });
}
