// src/db.js
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fs = require('fs');

// ── Vercel-specific database path ──────────────────────
// Vercel: Only /tmp is writable. SQLite must live there.
const DB_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'platform.db');

// Ensure the directory exists
if (!process.env.VERCEL && !fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ── Initialize or recover database ──────────────────────
let db;

function initDatabase() {
  // If database exists, try to open it
  if (fs.existsSync(DB_PATH)) {
    try {
      // Check if file is corrupted with JS code
      const buffer = fs.readFileSync(DB_PATH);
      const header = buffer.toString('utf8', 0, 16);
      
      // SQLite files start with "SQLite format 3\0"
      if (!header.includes('SQLite format 3')) {
        console.error('❌ Corrupted database file detected. Recreating...');
        fs.unlinkSync(DB_PATH);
        return createNewDatabase();
      }
      
      // Test if it's a valid SQLite database
      const testDb = new Database(DB_PATH);
      testDb.pragma('integrity_check');
      testDb.close();
      console.log('✅ Database opened successfully at:', DB_PATH);
      return new Database(DB_PATH);
      
    } catch (err) {
      console.error('❌ Database error:', err.message);
      if (fs.existsSync(DB_PATH)) {
        try {
          fs.unlinkSync(DB_PATH);
          console.log('🗑️ Deleted corrupted database file');
        } catch (unlinkErr) {
          console.error('Failed to delete corrupted file:', unlinkErr.message);
        }
      }
      return createNewDatabase();
    }
  }
  
  return createNewDatabase();
}

function createNewDatabase() {
  console.log('✅ Creating new database at:', DB_PATH);
  const newDb = new Database(DB_PATH);
  newDb.pragma('journal_mode = WAL');
  return newDb;
}

db = initDatabase();

// ── Tables ──────────────────────────────────────────────
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

// ── Lightweight migrations ──────────────────────────────
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'coins', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'referral_code', 'TEXT');
ensureColumn('users', 'referred_by', 'INTEGER');
ensureColumn('users', 'referral_rewarded_at', 'INTEGER');
ensureColumn('deployments', 'coins_charged', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_deployments_user_id ON deployments(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`);

// Backfill referral codes for any pre-existing rows that predate the column.
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex');
}

const missingCode = db.prepare(`SELECT id FROM users WHERE referral_code IS NULL`).all();
for (const row of missingCode) {
  db.prepare(`UPDATE users SET referral_code = ? WHERE id = ?`).run(generateReferralCode(), row.id);
}

// ── Users ───────────────────────────────────────────────

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

function setPlan(userId, plan) {
  db.prepare(`UPDATE users SET plan = ? WHERE id = ?`).run(plan, userId);
}

function setAdmin(userId, isAdmin) {
  db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(isAdmin ? 1 : 0, userId);
}

function addCoins(userId, amount) {
  db.prepare(`UPDATE users SET coins = coins + ? WHERE id = ?`).run(amount, userId);
  return getUserById(userId);
}

function deductCoinsIfSufficient(userId, amount) {
  const user = getUserById(userId);
  if (!user || user.coins < amount) return false;
  db.prepare(`UPDATE users SET coins = coins - ? WHERE id = ?`).run(amount, userId);
  return true;
}

function rewardReferrerIfDue(newUser, bonusCoins) {
  if (!newUser.referred_by || newUser.referral_rewarded_at) return;
  addCoins(newUser.referred_by, bonusCoins);
  db.prepare(`UPDATE users SET referral_rewarded_at = ? WHERE id = ?`).run(Date.now(), newUser.id);
}

function countReferrals(userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE referred_by = ?`).get(userId).n;
}

// ── Deployments ─────────────────────────────────────────

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

function getDeploymentStatsForUser(userId) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS n FROM deployments WHERE user_id = ? GROUP BY status
  `).all(userId);
  const stats = { total: 0, active: 0, inactive: 0, pending: 0 };
  for (const row of rows) {
    stats.total += row.n;
    if (row.status === 'succeeded') stats.active += row.n;
    else if (row.status === 'failed') stats.inactive += row.n;
    else stats.pending += row.n;
  }
  return stats;
}

function countActiveDeploymentsForBot(botSlug) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM deployments WHERE bot_slug = ? AND status = 'succeeded'
  `).get(botSlug).n;
}

// ── Admin Functions ──────────────────────────────────
function getAllUsers() {
  return db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all();
}

function getTotalUsers() {
  return db.prepare(`SELECT COUNT(*) AS count FROM users`).get().count;
}

function getTotalDeployments() {
  return db.prepare(`SELECT COUNT(*) AS count FROM deployments`).get().count;
}

function getActiveDeployments() {
  return db.prepare(`SELECT COUNT(*) AS count FROM deployments WHERE status = 'succeeded'`).get().count;
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
};