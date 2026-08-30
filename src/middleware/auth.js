// src/middleware/auth.js
const db = require('../db');

// ── Authentication Middleware ──────────────────────────
async function requireAuth(req, res, next) {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      req.session.flash = { type: 'error', message: 'Please login first' };
      return res.redirect('/login');
    }

    // Get user from database (with await)
    const user = await db.getUserById(req.session.userId);
    
    if (!user) {
      // User not found, clear session
      req.session.destroy(() => {});
      req.session.flash = { type: 'error', message: 'Session expired. Please login again.' };
      return res.redirect('/login');
    }

    // Attach user to request and response locals
    req.user = user;
    res.locals.user = user;
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