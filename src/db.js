// src/db.js
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fs = require('fs');

// ── Database Path ──────────────────────────────────────
const DB_DIR = process.env.RENDER ? '/tmp' : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'platform.db');

console.log(`📁 Database path: ${DB_PATH}`);
console.log(`🌍 Platform: ${process.env.RENDER ? 'Render' : 'Local'}`);

// Ensure directory exists
if (!fs.existsSync(DB_DIR)) {
  console.log(`📁 Creating directory: ${DB_DIR}`);
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ── Database initialization ──────────────────────────
function getDatabase() {
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

  try {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.prepare('SELECT 1').get();
    console.log('✅ Database opened successfully');
    return db;
  } catch (err) {
    console.error('❌ Failed to open database:', err.message);
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
      console.log('🗑️ Removed corrupted file');
    }
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    console.log('✅ New database created');
    return db;
  }
}

// ── Initialize database ──────────────────────────────
let db;
try {
  db = getDatabase();
} catch (err) {
  console.error('❌ Fatal database error:', err);
  process.exit(1);
}

// ── Create tables ─────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
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
  );

  CREATE TABLE IF NOT EXISTS deployments (
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
  );
`);

// ── Indexes ───────────────────────────────────────────
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
  CREATE INDEX IF NOT EXISTS idx_deployments_user_id ON deployments(user_id);
  CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
`);

// ── Helper Functions ─────────────────────────────────
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex');
}

// ── User Functions ────────────────────────────────────
function createUser({ email, passwordHash, startingCoins = 0, referredBy = null }) {
  const stmt = db.prepare(`
    INSERT INTO users (email, password_hash, coins, referral_code, referred_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    email.toLowerCase().trim(),
    passwordHash,
    startingCoins,
    generateReferralCode(),
    referredBy,
    Date.now()
  );
  return getUserById(info.lastInsertRowid);
}

function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

function getUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim());
}

function getUserByReferralCode(code) {
  if (!code) return null;
  return db.prepare(`SELECT * FROM users WHERE referral_code = ?`).get(code.trim());
}

function setOtp(userId, { code, expiresAt }) {
  db.prepare(`
    UPDATE users SET otp_code = ?, otp_expires_at = ?, otp_last_sent_at = ?
    WHERE id = ?
  `).run(code, expiresAt, Date.now(), userId);
}

function clearOtp(userId) {
  db.prepare(`UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?`).run(userId);
}

function markVerified(userId) {
  db.prepare(`UPDATE users SET verified = 1 WHERE id = ?`).run(userId);
}

function setAdmin(userId, isAdmin) {
  db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(isAdmin ? 1 : 0, userId);
}

function addCoins(userId, amount) {
  db.prepare(`UPDATE users SET coins = coins + ? WHERE id = ?`).run(amount, userId);
  return getUserById(userId);
}

function rewardReferrerIfDue(newUser, bonusCoins) {
  if (!newUser.referred_by || newUser.referral_rewarded_at) return;
  addCoins(newUser.referred_by, bonusCoins);
  db.prepare(`UPDATE users SET referral_rewarded_at = ? WHERE id = ?`).run(Date.now(), newUser.id);
}

function getAllUsers() {
  return db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all();
}

function getTotalUsers() {
  return db.prepare(`SELECT COUNT(*) AS count FROM users`).get().count;
}

// ── Deployment Functions ─────────────────────────────
function createDeployment({ userId, botSlug, appName, herokuAppSetupId, coinsCharged = 0 }) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO deployments (user_id, bot_slug, app_name, heroku_app_setup_id, coins_charged, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(userId, botSlug, appName, herokuAppSetupId, coinsCharged, now, now);
  return getDeploymentById(info.lastInsertRowid);
}

function getDeploymentById(id) {
  return db.prepare(`SELECT * FROM deployments WHERE id = ?`).get(id);
}

function updateDeploymentStatus(id, { status, herokuAppUrl, failureMessage }) {
  db.prepare(`
    UPDATE deployments
    SET status = ?, heroku_app_url = ?, failure_message = ?, updated_at = ?
    WHERE id = ?
  `).run(status, herokuAppUrl || null, failureMessage || null, Date.now(), id);
}

function listDeploymentsForUser(userId, limit = 20) {
  return db.prepare(`
    SELECT * FROM deployments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit);
}

// ── Health Check ──────────────────────────────────────
function checkDatabaseHealth() {
  try {
    db.prepare('SELECT 1').get();
    return { healthy: true, path: DB_PATH, render: !!process.env.RENDER };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

// ── Sync function for server.js ──────────────────────
function ensureInitialized() {
  // With better-sqlite3, the database is already initialized
  // This function exists for compatibility with server.js
  return Promise.resolve();
}

module.exports = {
  db,
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
  checkDatabaseHealth,
  ensureInitialized, // Added for compatibility
};