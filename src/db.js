// src/db.js
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// ── Database Path ──────────────────────────────────────
const DB_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'platform.db');

console.log(`📁 Database path: ${DB_PATH}`);
console.log(`🌍 Environment: ${process.env.VERCEL ? 'Vercel' : 'Local'}`);

// Ensure directory exists
if (!fs.existsSync(DB_DIR)) {
  console.log(`📁 Creating directory: ${DB_DIR}`);
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ── Database Connection ──────────────────────────────
let db;

function getDatabase() {
  return new Promise((resolve, reject) => {
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

// ── Helper to promisify sqlite3 ──────────────────────
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

// ── Initialize Database ──────────────────────────────
let dbInstance;

async function initializeDatabase() {
  try {
    dbInstance = await getDatabase();
    
    // Enable WAL mode
    await runQuery(dbInstance, 'PRAGMA journal_mode = WAL');
    await runQuery(dbInstance, 'PRAGMA foreign_keys = ON');
    
    // Create tables
    await createTables();
    await createIndexes();
    await applyMigrations();
    
    return dbInstance;
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
      await execQuery(dbInstance, tableSQL);
      console.log('✅ Table created');
    } catch (err) {
      console.error('❌ Failed to create table:', err.message);
    }
  }
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
      await execQuery(dbInstance, indexSQL);
      console.log('✅ Index created');
    } catch (err) {
      console.error('❌ Failed to create index:', err.message);
    }
  }
}

async function applyMigrations() {
  const columns = [
    { table: 'users', column: 'coins', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'users', column: 'is_admin', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'users', column: 'referral_code', definition: 'TEXT' },
    { table: 'users', column: 'referred_by', definition: 'INTEGER' },
    { table: 'users', column: 'referral_rewarded_at', definition: 'INTEGER' },
    { table: 'deployments', column: 'coins_charged', definition: 'INTEGER NOT NULL DEFAULT 0' }
  ];

  for (const { table, column, definition } of columns) {
    try {
      const cols = await allQuery(dbInstance, `PRAGMA table_info(${table})`);
      const colNames = cols.map(c => c.name);
      if (!colNames.includes(column)) {
        await execQuery(dbInstance, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`✅ Added column ${column} to ${table}`);
      }
    } catch (err) {
      console.error(`❌ Failed to add column ${column}:`, err.message);
    }
  }

  // Backfill referral codes
  try {
    const missing = await allQuery(dbInstance, `SELECT id FROM users WHERE referral_code IS NULL`);
    for (const row of missing) {
      const code = generateReferralCode();
      await runQuery(dbInstance, `UPDATE users SET referral_code = ? WHERE id = ?`, [code, row.id]);
    }
    if (missing.length > 0) {
      console.log(`✅ Backfilled ${missing.length} referral codes`);
    }
  } catch (err) {
    console.error('❌ Referral backfill error:', err.message);
  }
}

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex');
}

// ── Database Functions ──────────────────────────────

async function createUser({ email, passwordHash, startingCoins = 0, referredBy = null }) {
  try {
    const result = await runQuery(dbInstance, 
      `INSERT INTO users (email, password_hash, coins, referral_code, referred_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email.toLowerCase().trim(), passwordHash, startingCoins, generateReferralCode(), referredBy, Date.now()]
    );
    return getUserById(result.lastID);
  } catch (err) {
    console.error('❌ Create user error:', err);
    throw err;
  }
}

async function getUserById(id) {
  try {
    return await getQuery(dbInstance, `SELECT * FROM users WHERE id = ?`, [id]);
  } catch (err) {
    console.error('❌ Get user by id error:', err);
    return null;
  }
}

async function getUserByEmail(email) {
  try {
    return await getQuery(dbInstance, `SELECT * FROM users WHERE email = ?`, [email.toLowerCase().trim()]);
  } catch (err) {
    console.error('❌ Get user by email error:', err);
    return null;
  }
}

async function getUserByReferralCode(code) {
  if (!code) return null;
  try {
    return await getQuery(dbInstance, `SELECT * FROM users WHERE referral_code = ?`, [code.trim()]);
  } catch (err) {
    console.error('❌ Get user by referral code error:', err);
    return null;
  }
}

async function setOtp(userId, { code, expiresAt }) {
  try {
    await runQuery(dbInstance,
      `UPDATE users SET otp_code = ?, otp_expires_at = ?, otp_last_sent_at = ? WHERE id = ?`,
      [code, expiresAt, Date.now(), userId]
    );
  } catch (err) {
    console.error('❌ Set OTP error:', err);
    throw err;
  }
}

async function clearOtp(userId) {
  try {
    await runQuery(dbInstance,
      `UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?`,
      [userId]
    );
  } catch (err) {
    console.error('❌ Clear OTP error:', err);
    throw err;
  }
}

async function markVerified(userId) {
  try {
    await runQuery(dbInstance,
      `UPDATE users SET verified = 1 WHERE id = ?`,
      [userId]
    );
  } catch (err) {
    console.error('❌ Mark verified error:', err);
    throw err;
  }
}

async function setPlan(userId, plan) {
  try {
    await runQuery(dbInstance,
      `UPDATE users SET plan = ? WHERE id = ?`,
      [plan, userId]
    );
  } catch (err) {
    console.error('❌ Set plan error:', err);
    throw err;
  }
}

async function setAdmin(userId, isAdmin) {
  try {
    await runQuery(dbInstance,
      `UPDATE users SET is_admin = ? WHERE id = ?`,
      [isAdmin ? 1 : 0, userId]
    );
  } catch (err) {
    console.error('❌ Set admin error:', err);
    throw err;
  }
}

async function addCoins(userId, amount) {
  try {
    await runQuery(dbInstance,
      `UPDATE users SET coins = coins + ? WHERE id = ?`,
      [amount, userId]
    );
    return getUserById(userId);
  } catch (err) {
    console.error('❌ Add coins error:', err);
    throw err;
  }
}

async function deductCoinsIfSufficient(userId, amount) {
  try {
    const user = await getUserById(userId);
    if (!user || user.coins < amount) return false;
    await runQuery(dbInstance,
      `UPDATE users SET coins = coins - ? WHERE id = ?`,
      [amount, userId]
    );
    return true;
  } catch (err) {
    console.error('❌ Deduct coins error:', err);
    return false;
  }
}

async function rewardReferrerIfDue(newUser, bonusCoins) {
  try {
    if (!newUser.referred_by || newUser.referral_rewarded_at) return;
    await addCoins(newUser.referred_by, bonusCoins);
    await runQuery(dbInstance,
      `UPDATE users SET referral_rewarded_at = ? WHERE id = ?`,
      [Date.now(), newUser.id]
    );
  } catch (err) {
    console.error('❌ Reward referrer error:', err);
  }
}

async function countReferrals(userId) {
  try {
    const result = await getQuery(dbInstance,
      `SELECT COUNT(*) AS n FROM users WHERE referred_by = ?`,
      [userId]
    );
    return result ? result.n : 0;
  } catch (err) {
    console.error('❌ Count referrals error:', err);
    return 0;
  }
}

async function createDeployment({ userId, botSlug, appName, herokuAppSetupId, coinsCharged = 0 }) {
  try {
    const now = Date.now();
    const result = await runQuery(dbInstance,
      `INSERT INTO deployments (user_id, bot_slug, app_name, heroku_app_setup_id, coins_charged, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [userId, botSlug, appName, herokuAppSetupId, coinsCharged, now, now]
    );
    return getDeploymentById(result.lastID);
  } catch (err) {
    console.error('❌ Create deployment error:', err);
    throw err;
  }
}

async function getDeploymentById(id) {
  try {
    return await getQuery(dbInstance, `SELECT * FROM deployments WHERE id = ?`, [id]);
  } catch (err) {
    console.error('❌ Get deployment error:', err);
    return null;
  }
}

async function updateDeploymentStatus(id, { status, herokuAppUrl, failureMessage }) {
  try {
    await runQuery(dbInstance,
      `UPDATE deployments SET status = ?, heroku_app_url = ?, failure_message = ?, updated_at = ? WHERE id = ?`,
      [status, herokuAppUrl || null, failureMessage || null, Date.now(), id]
    );
  } catch (err) {
    console.error('❌ Update deployment status error:', err);
    throw err;
  }
}

async function listDeploymentsForUser(userId, limit = 20) {
  try {
    return await allQuery(dbInstance,
      `SELECT * FROM deployments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
  } catch (err) {
    console.error('❌ List deployments error:', err);
    return [];
  }
}

async function getDeploymentStatsForUser(userId) {
  try {
    const rows = await allQuery(dbInstance,
      `SELECT status, COUNT(*) AS n FROM deployments WHERE user_id = ? GROUP BY status`,
      [userId]
    );
    const stats = { total: 0, active: 0, inactive: 0, pending: 0 };
    for (const row of rows) {
      stats.total += row.n;
      if (row.status === 'succeeded') stats.active += row.n;
      else if (row.status === 'failed') stats.inactive += row.n;
      else stats.pending += row.n;
    }
    return stats;
  } catch (err) {
    console.error('❌ Get deployment stats error:', err);
    return { total: 0, active: 0, inactive: 0, pending: 0 };
  }
}

async function countActiveDeploymentsForBot(botSlug) {
  try {
    const result = await getQuery(dbInstance,
      `SELECT COUNT(*) AS n FROM deployments WHERE bot_slug = ? AND status = 'succeeded'`,
      [botSlug]
    );
    return result ? result.n : 0;
  } catch (err) {
    console.error('❌ Count active deployments error:', err);
    return 0;
  }
}

async function getAllUsers() {
  try {
    return await allQuery(dbInstance, `SELECT * FROM users ORDER BY created_at DESC`);
  } catch (err) {
    console.error('❌ Get all users error:', err);
    return [];
  }
}

async function getTotalUsers() {
  try {
    const result = await getQuery(dbInstance, `SELECT COUNT(*) AS count FROM users`);
    return result ? result.count : 0;
  } catch (err) {
    console.error('❌ Get total users error:', err);
    return 0;
  }
}

async function getTotalDeployments() {
  try {
    const result = await getQuery(dbInstance, `SELECT COUNT(*) AS count FROM deployments`);
    return result ? result.count : 0;
  } catch (err) {
    console.error('❌ Get total deployments error:', err);
    return 0;
  }
}

async function getActiveDeployments() {
  try {
    const result = await getQuery(dbInstance, 
      `SELECT COUNT(*) AS count FROM deployments WHERE status = 'succeeded'`
    );
    return result ? result.count : 0;
  } catch (err) {
    console.error('❌ Get active deployments error:', err);
    return 0;
  }
}

async function checkDatabaseHealth() {
  try {
    await getQuery(dbInstance, 'SELECT 1');
    return { healthy: true, path: DB_PATH, vercel: !!process.env.VERCEL };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

// ── Initialize and Export ─────────────────────────────
let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initializeDatabase();
    initialized = true;
  }
  return dbInstance;
}

// Auto-initialize
ensureInitialized().catch(err => {
  console.error('❌ Failed to initialize database:', err);
  process.exit(1);
});

module.exports = {
  db: dbInstance,
  createUser,
  getUserById,
  getUserByEmail,
  getUserByReferralCode,
  setOtp,
  clearOtp,
  markVerified,
  setPlan,
  setAdmin,
  addCoins,
  deductCoinsIfSufficient,
  rewardReferrerIfDue,
  countReferrals,
  createDeployment,
  getDeploymentById,
  updateDeploymentStatus,
  listDeploymentsForUser,
  getDeploymentStatsForUser,
  countActiveDeploymentsForBot,
  getAllUsers,
  getTotalUsers,
  getTotalDeployments,
  getActiveDeployments,
  checkDatabaseHealth,
  ensureInitialized,
};