const sqlite3 = require('sqlite3').verbose();
const { STATE_DB_PATH } = require('./paths');

const db = new sqlite3.Database(STATE_DB_PATH);

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS plays (id INTEGER PRIMARY KEY, song_id TEXT, title TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS plan (id INTEGER PRIMARY KEY, plan_data TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT)");
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function recordPlay(songId, title) {
  const normalizedId = String(songId);
  const result = await run(
    `INSERT INTO plays (song_id, title)
     SELECT ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM plays
       WHERE song_id = ? AND timestamp >= datetime('now', '-30 seconds')
     )`,
    [normalizedId, title, normalizedId]
  );
  return result.id;
}

module.exports = {
  db,
  addMessage: async (role, content) => {
    const result = await run(
      'INSERT INTO messages (role, content) VALUES (?, ?)',
      [role, content]
    );
    return result.id;
  },
  getMessages: async (limit = 10) => {
    const rows = await all(
      'SELECT * FROM messages ORDER BY id DESC LIMIT ?',
      [Math.max(1, Math.min(100, Number(limit) || 10))]
    );
    return rows.reverse();
  },
  addPlay: recordPlay,
  recordPlay,
  getPlays: (limit = 20) => all(
    'SELECT * FROM plays ORDER BY id DESC LIMIT ?',
    [Math.max(1, Math.min(100, Number(limit) || 20))]
  ),
  getUniquePlays: (limit = 300) => all(
    `SELECT song_id, MAX(title) AS title, COUNT(*) AS play_count,
            MAX(timestamp) AS last_played, MAX(id) AS last_id
     FROM plays
     GROUP BY song_id
     ORDER BY last_id DESC
     LIMIT ?`,
    [Math.max(1, Math.min(1000, Number(limit) || 300))]
  ),
  savePlan: async (plan) => {
    const result = await run(
      'INSERT INTO plan (plan_data) VALUES (?)',
      [JSON.stringify(plan)]
    );
    return result.id;
  },
  getLatestPlan: async () => {
    const [row] = await all('SELECT * FROM plan ORDER BY id DESC LIMIT 1');
    if (!row) return null;
    try {
      return JSON.parse(row.plan_data);
    } catch (error) {
      return null;
    }
  },
  setPref: (key, value) => run(
    `INSERT INTO prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)]
  ),
  getPref: async (key, fallback = null) => {
    const [row] = await all('SELECT value FROM prefs WHERE key = ?', [key]);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch (error) {
      return fallback;
    }
  }
};
