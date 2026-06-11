const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'wedding.db');

let _db = null;

function save() {
  if (_db) {
    const data = _db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

function getLastId() {
  try {
    const results = _db.exec('SELECT last_insert_rowid() as id');
    if (results && results.length > 0 && results[0].values && results[0].values.length > 0) {
      return results[0].values[0][0];
    }
  } catch (e) {
    if (typeof e === 'object' && e !== null) {
      console.error('getLastId error:', e.message || e);
    }
  }
  return null;
}

const api = {
  prepare(sql) {
    return {
      get(params) {
        const stmt = _db.prepare(sql);
        stmt.bind(params || []);
        let result = null;
        if (stmt.step()) {
          result = stmt.getAsObject();
        }
        stmt.free();
        return result;
      },
      all(params) {
        const stmt = _db.prepare(sql);
        stmt.bind(params || []);
        const results = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
      run(params) {
        _db.run(sql, params || []);
        const id = getLastId();
        save();
        return { lastInsertRowid: id };
      }
    };
  },
  exec(sql) {
    _db.exec(sql);
    save();
  }
};

async function init() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    _db = new SQL.Database(buffer);
  } else {
    _db = new SQL.Database();
  }

  _db.run('PRAGMA foreign_keys = ON');

  _db.run(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_type TEXT DEFAULT 'Wedding',
      groom_name TEXT,
      bride_name TEXT,
      person1_name TEXT,
      person2_name TEXT,
      event_date TEXT,
      venue TEXT,
      unique_link TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);

  try { _db.run("ALTER TABLE events ADD COLUMN event_type TEXT DEFAULT 'Wedding'"); } catch(e) {}
  try { _db.run('ALTER TABLE events ADD COLUMN person1_name TEXT'); } catch(e) {}
  try { _db.run('ALTER TABLE events ADD COLUMN person2_name TEXT'); } catch(e) {}
  try { _db.run('ALTER TABLE events ADD COLUMN target_amount REAL DEFAULT 0'); } catch(e) {}
  try { _db.run('ALTER TABLE events ADD COLUMN manage_token TEXT'); } catch(e) {}
  try { _db.run("ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'Active'"); } catch(e) {}

  _db.run(`
    CREATE TABLE IF NOT EXISTS contributors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      contribution_type TEXT NOT NULL,
      promise_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      remaining_balance REAL DEFAULT 0,
      payment_method TEXT,
      sender_name TEXT,
      status TEXT DEFAULT 'Incomplete',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contributor_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      sender_name TEXT,
      paid_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (contributor_id) REFERENCES contributors(id)
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);

  try { _db.run('ALTER TABLE contributors ADD COLUMN contributor_id TEXT'); } catch(e) {}
  try { _db.run('ALTER TABLE contributors ADD COLUMN notes TEXT'); } catch(e) {}

  const missingResult = _db.exec('SELECT id FROM contributors WHERE contributor_id IS NULL ORDER BY id');
  if (missingResult.length > 0 && missingResult[0].values) {
    for (const row of missingResult[0].values) {
      _db.run('UPDATE contributors SET contributor_id = ? WHERE id = ?', ['CNT-' + String(row[0]).padStart(3, '0'), row[0]]);
    }
    save();
  }

  const missingManage = _db.exec('SELECT id FROM events WHERE manage_token IS NULL');
  if (missingManage.length > 0 && missingManage[0].values) {
    for (const row of missingManage[0].values) {
      _db.run('UPDATE events SET manage_token = ? WHERE id = ?', [crypto.randomBytes(8).toString('hex'), row[0]]);
    }
    save();
  }

  save();

  const stmt = _db.prepare('SELECT id FROM admin LIMIT 1');
  const exists = stmt.step();
  stmt.free();

  if (!exists) {
    const hash = bcrypt.hashSync('admin123', 10);
    _db.run('INSERT INTO admin (username, password_hash) VALUES (?, ?)', ['admin', hash]);
    save();
    console.log('Default admin created (username: admin, password: admin123)');
  }

  return api;
}

module.exports = { init };
