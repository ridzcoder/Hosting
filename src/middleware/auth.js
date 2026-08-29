const db = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  const user = db.getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }
  req.user = user;
  res.locals.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(404).render('404', { title: 'Not found' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
