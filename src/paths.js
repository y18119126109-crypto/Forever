const fs = require('fs/promises');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.resolve(process.env.SWAGGER_DATA_DIR || APP_ROOT);
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const DEFAULT_AVATAR_PATH = path.join(PUBLIC_DIR, 'assets', 'forever-avatar.png');
const USER_DIR = path.join(DATA_ROOT, 'user');
const UPLOADS_DIR = path.join(DATA_ROOT, 'public', 'uploads');
const TTS_CACHE_DIR = path.join(DATA_ROOT, 'cache', 'tts');
const STATE_DB_PATH = path.join(DATA_ROOT, 'state.db');
const ENV_PATH = process.env.SWAGGER_ENV_FILE || path.join(DATA_ROOT, '.env');
const BUNDLED_USER_DIR = path.join(APP_ROOT, 'user');

const USER_FILES = [
  ['taste.md', '# My Taste\n'],
  ['routines.md', '# Routines\n'],
  ['mood-rules.md', '# Mood Rules\n'],
  ['playlists.json', '{\n  "favorites": [],\n  "morning": []\n}\n']
];

async function copyIfMissing(source, target, fallback) {
  try {
    await fs.access(target);
    return;
  } catch (error) {
    // Initialize the desktop profile below.
  }

  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(target, fallback, 'utf8');
  }
}

async function ensureDataLayout() {
  await Promise.all([
    fs.mkdir(USER_DIR, { recursive: true }),
    fs.mkdir(UPLOADS_DIR, { recursive: true }),
    fs.mkdir(TTS_CACHE_DIR, { recursive: true })
  ]);

  if (DATA_ROOT === APP_ROOT) return;
  await Promise.all(USER_FILES.map(([filename, fallback]) =>
    copyIfMissing(
      path.join(BUNDLED_USER_DIR, filename),
      path.join(USER_DIR, filename),
      fallback
    )
  ));
}

module.exports = {
  APP_ROOT,
  BUNDLED_USER_DIR,
  DATA_ROOT,
  DEFAULT_AVATAR_PATH,
  ENV_PATH,
  PUBLIC_DIR,
  STATE_DB_PATH,
  TTS_CACHE_DIR,
  UPLOADS_DIR,
  USER_DIR,
  ensureDataLayout
};
