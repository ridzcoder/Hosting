const bcrypt = require('bcryptjs');
const db = require('../db');

// Creates the admin account from ADMIN_EMAIL / ADMIN_PASSWORD on first
// boot. If that account already exists, this only makes sure the
// is_admin flag is set — it never touches the stored password, so
// restarting the server doesn't clobber a password you've since
// changed some other way.
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('[admin] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const existing = db.getUserByEmail(email);
  if (existing) {
    if (!existing.is_admin) db.setAdmin(existing.id, true);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = db.createUser({ email, passwordHash, startingCoins: 0 });
  db.markVerified(admin.id);
  db.setAdmin(admin.id, true);
  console.log(`[admin] Created admin account for ${email}`);
}

module.exports = { seedAdmin };
