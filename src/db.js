// src/db.js
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// ── Database Path ──────────────────────────────────────
// Use data/ folder for both local and Render
const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'platform.db');

console.log(`📁 Database path: ${DB_PATH}`);
console.log(`🌍 Platform: ${process.env.RENDER ? 'Render' : 'Local'}`);

// Ensure directory exists
if (!fs.existsSync(DB_DIR)) {
  console.log(`📁 Creating directory: ${DB_DIR}`);
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ── Promise wrappers for sqlite3 ──────────────────────
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function execQuery(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Database initialization ──────────────────────────
let db = null;
let dbInitialized = false;

function getDatabase() {
  return new Promise((resolve, reject) => {
    // Check if file exists and is valid SQLite
    if (fs.existsSync(DB_PATH)) {
      try {
        const buffer = fs.readFileSync(DB_PATH);
        const header = buffer.toString('utf8', 0, 16);
        if (!header.includes('SQLite format 3')) {
          console.log('🗑️ Removing invalid database file...');
          fs.unlinkSync(DB_PATH);
        }
      } catch (err) {
        console.error('❌ Error checking database:', err.message);
        if (fs.existsSync(DB_PATH)) {
          try {
            fs.unlinkSync(DB_PATH);
          } catch (e) {
            console.error('❌ Failed to delete file:', e.message);
          }
        }
      }
    }

    const dbInstance = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('❌ Database connection error:', err.message);
        if (fs.existsSync(DB_PATH)) {
          try {
            fs.unlinkSync(DB_PATH);
            console.log('🗑️ Removed corrupted database');
            // Retry with new connection
            const newDb = new sqlite3.Database(DB_PATH, (retryErr) => {
              if (retryErr) {
                reject(retryErr);
              } else {
                console.log('✅ New database created');
                resolve(newDb);
              }
            });
          } catch (unlinkErr) {
            reject(unlinkErr);
          }
        } else {
          reject(err);
        }
      } else {
        console.log('✅ Database opened successfully');
        resolve(dbInstance);
      }
    });
  });
}

// ── Initialize Database ──────────────────────────────
async function initializeDatabase() {
  try {
    db = await getDatabase();
    
    // Enable WAL mode and set busy timeout
    await runQuery(db, 'PRAGMA journal_mode = WAL');
    await runQuery(db, 'PRAGMA foreign_keys = ON');
    await runQuery(db, 'PRAGMA busy_timeout = 5000');
    
    // Create tables
    await createTables();
    await createIndexes();
    
    dbInitialized = true;
    console.log('✅ Database ready');
    return db;
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    throw err;
  }
}

async function createTables() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT UNIQUE NOT NULL,
      password_hash   TEXT NOT NULL,
      verified        INTEGER NOT NULL DEFAULT 0,
      otp_code        TEXT,
      otp_expires_at  INTEGER,
      otp_last_sent_at INTEGER,
      plan            TEXT NOT NULL DEFAULT 'none',
      coins           INTEGER NOT NULL DEFAULT 0,
      is_admin        INTEGER NOT NULL DEFAULT 0,
      referral_code   TEXT,
      referred_by     INTEGER,
      referral_rewarded_at INTEGER,
      created_at      INTEGER NOT NULL
    )`,
    
    `CREATE TABLE IF NOT EXISTS deployments (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL REFERENCES users(id),
      bot_slug             TEXT NOT NULL,
      app_name             TEXT NOT NULL,
      heroku_app_setup_id  TEXT,
      status               TEXT NOT NULL DEFAULT 'pending',
      heroku_app_url       TEXT,
      failure_message      TEXT,
      coins_charged        INTEGER NOT NULL DEFAULT 0,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL
    )`
  ];

  for (const tableSQL of tables) {
    try {
      await execQuery(db, tableSQL);
    } catch (err) {
      console.error('❌ Failed to create table:', err.message);
    }
  }
  console.log('✅ Tables created/verified');
}

async function createIndexes() {
  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`,
    `CREATE INDEX IF NOT EXISTS idx_deployments_user_id ON deployments(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`
  ];

  for (const indexSQL of indexes) {
    try {
      await execQuery(db, indexSQL);
    } catch (err) {
      console.error('❌ Failed to create index:', err.message);
    }
  }
  console.log('✅ Indexes created/verified');
}

// ── Helper Functions ─────────────────────────────────
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex');
}

// ── Ensure DB is initialized ─────────────────────────
async function ensureInitialized() {
  if (!dbInitialized) {
    await initializeDatabase();
  }
  return db;
}

// ── User Functions ────────────────────────────────────
async function createUser({ email, passwordHash, startingCoins = 0, referredBy = null }) {
  await ensureInitialized();
  const result = await runQuery(db,
    `INSERT INTO users (email, password_hash, coins, referral_code, referred_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [email.toLowerCase().trim(), passwordHash, startingCoins, generateReferralCode(), referredBy, Date.now()]
  );
  return getUserById(result.lastID);
}

async function getUserById(id) {
  await ensureInitialized();
  return getQuery(db, `SELECT * FROM users WHERE id = ?`, [id]);
}

async function getUserByEmail(email) {
  await ensureInitialized();
  return getQuery(db, `SELECT * FROM users WHERE email = ?`, [email.toLowerCase().trim()]);
}

async function getUserByReferralCode(code) {
  if (!code) return null;
  await ensureInitialized();
  return getQuery(db, `SELECT * FROM users WHERE referral_code = ?`, [code.trim()]);
}

async function setOtp(userId, { code, expiresAt }) {
  await ensureInitialized();
  await runQuery(db,
    `UPDATE users SET otp_code = ?, otp_expires_at = ?, otp_last_sent_at = ? WHERE id = ?`,
    [code, expiresAt, Date.now(), userId]
  );
}

async function clearOtp(userId) {
  await ensureInitialized();
  await runQuery(db,
    `UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?`,
    [userId]
  );
}

async function markVerified(userId) {
  await ensureInitialized();
  await runQuery(db,
    `UPDATE users SET verified = 1 WHERE id = ?`,
    [userId]
  );
}

async function setAdmin(userId, isAdmin) {
  await ensureInitialized();
  await runQuery(db,
    `UPDATE users SET is_admin = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, userId]
  );
}

async function addCoins(userId, amount) {
  await ensureInitialized();
  await runQuery(db,
    `UPDATE users SET coins = coins + ? WHERE id = ?`,
    [amount, userId]
  );
  return getUserById(userId);
}

async function rewardReferrerIfDue(newUser, bonusCoins) {
  if (!newUser.referred_by || newUser.referral_rewarded_at) return;
  await addCoins(newUser.referred_by, bonusCoins);
  await runQuery(db,
    `UPDATE users SET referral_rewarded_at = ? WHERE id = ?`,
    [Date.now(), newUser.id]
  );
}

async function getAllUsers() {
  await ensureInitialized();
  return allQuery(db, `SELECT * FROM users ORDER BY created_at DESC`);
}

async function getTotalUsers() {
  await ensureInitialized();
  const result = await getQuery(db, `SELECT COUNT(*) AS count FROM users`);
  return result ? result.count : 0;
}

// ── Deployment Functions ─────────────────────────────
async function createDeployment({ userId, botSlug, appName, herokuAppSetupId, coinsCharged = 0 }) {
  await ensureInitialized();
  const now = Date.now();
  const result = await runQuery(db,
    `INSERT INTO deployments (user_id, bot_slug, app_name, heroku_app_setup_id, coins_charged, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [userId, botSlug, appName, herokuAppSetupId, coinsCharged, now, now]
  );
  return getDeploymentById(result.lastID);
}

async function getDeploymentById(id) {
  await ensureInitialized();
  return getQuery(db, `SELECT * FROM deployments WHERE id = ?`, [id]);
}

async function updateDeploymentStatus(id, { status, herokuAppUrl, failureMessage }) {
  await ensureInitialized();
  await runQuery(db,
    `UPDATE deployments SET status = ?, heroku_app_url = ?, failure_message = ?, updated_at = ? WHERE id = ?`,
    [status, herokuAppUrl || null, failureMessage || null, Date.now(), id]
  );
}

async function listDeploymentsForUser(userId, limit = 20) {
  await ensureInitialized();
  return allQuery(db,
    `SELECT * FROM deployments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
}

// ── Health Check ──────────────────────────────────────
async function checkDatabaseHealth() {
  try {
    await ensureInitialized();
    await getQuery(db, 'SELECT 1');
    return { healthy: true, path: DB_PATH, render: !!process.env.RENDER };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

// ── Initialize on first require ──────────────────────
// Auto-initialize (but don't block)
initializeDatabase().catch(err => {
  console.error('❌ Failed to initialize database:', err);
});

module.exports = {
  db,
  ensureInitialized,
  checkDatabaseHealth,
  createUser,
  getUserById,
  getUserByEmail,
  getUserByReferralCode,
  setOtp,
  clearOtp,
  markVerified,
  setAdmin,
  addCoins,
  rewardReferrerIfDue,
  getAllUsers,
  getTotalUsers,
  createDeployment,
  getDeploymentById,
  updateDeploymentStatus,
  listDeploymentsForUser,
};