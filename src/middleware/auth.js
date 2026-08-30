// src/middleware/auth.js
const db = require('../db');

// ── Authentication Middleware ──────────────────────────
async function requireAuth(req, res, next) {
  try {
    console.log('🔐 Auth check - Session:', req.session);
    console.log('🔐 Auth check - UserId:', req.session?.userId);

    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      console.log('❌ No session or userId found, redirecting to login');
      req.session.flash = { type: 'error', message: 'Please login first' };
      return res.redirect('/login');
    }

    // Get user from database
    const user = await db.getUserById(req.session.userId);
    
    if (!user) {
      console.log('❌ User not found in database, destroying session');
      req.session.destroy(() => {});
      req.session.flash = { type: 'error', message: 'Session expired. Please login again.' };
      return res.redirect('/login');
    }

    // Check if user is verified
    if (!user.verified) {
      console.log('⚠️ User not verified, redirecting to verify');
      req.session.flash = { type: 'error', message: 'Please verify your email first' };
      return res.redirect('/verify');
    }

    // Attach user to request and response locals
    req.user = user;
    res.locals.user = user;
    console.log(`✅ User authenticated: ${user.email} (ID: ${user.id})`);
    next();
    
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    req.session.flash = { type: 'error', message: 'Authentication failed' };
    res.redirect('/login');
  }
}

// ── Admin Middleware ──────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(404).render('404', { title: 'Not found' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };