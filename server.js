// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const fs = require('fs');

// Check database path
const DB_PATH = process.env.VERCEL ? '/tmp/platform.db' : path.join(__dirname, 'data', 'platform.db');
console.log(`📁 Database path: ${DB_PATH}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔧 Vercel: ${!!process.env.VERCEL}`);

const { seedAdmin } = require('./src/services/seedAdmin');
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const deployRoutes = require('./src/routes/deploy');
const adminRoutes = require('./src/routes/admin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src', 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

// Consume the one-shot flash message set by routes via req.session.flash.
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  res.locals.siteName = process.env.SITE_NAME || 'Bot Deploy';
  res.locals.teamName = process.env.TEAM_NAME || process.env.SITE_NAME || 'Bot Deploy';
  res.locals.currentPath = req.path;
  delete req.session.flash;
  next();
});

app.get('/', (req, res) => res.redirect(req.session.userId ? '/dashboard' : '/login'));

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(deployRoutes);
app.use(adminRoutes);

app.use((req, res) => res.status(404).render('404', { title: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { title: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
const siteName = process.env.SITE_NAME || 'Bot Deploy';

seedAdmin()
  .catch((err) => console.error('[admin] seed failed:', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`${siteName} running on http://localhost:${PORT}`);
      console.log(`📁 Database: ${DB_PATH}`);
    });
  });