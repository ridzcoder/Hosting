// server.js - Updated for better-sqlite3
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./src/db'); // No need for async
const { seedAdmin } = require('./src/services/seedAdmin');
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const deployRoutes = require('./src/routes/deploy');
const adminRoutes = require('./src/routes/admin');

const app = express();

// ── Trust proxy for Render ─────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  console.log('🔒 Trust proxy enabled (Render)');
}

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
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

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

// Health check
app.get('/api/health', (req, res) => {
  const health = db.checkDatabaseHealth();
  if (health.healthy) {
    res.json({ 
      status: 'healthy', 
      database: 'connected',
      path: health.path,
      render: health.render,
      environment: process.env.NODE_ENV || 'development'
    });
  } else {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: health.error 
    });
  }
});

app.use((req, res) => res.status(404).render('404', { title: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { title: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
const siteName = process.env.SITE_NAME || 'Bot Deploy';

// Start server (no async needed for better-sqlite3)
try {
  // Seed admin
  seedAdmin()
    .catch(err => console.error('[admin] seed failed:', err))
    .finally(() => {
      app.listen(PORT, () => {
        console.log(`${siteName} running on http://localhost:${PORT}`);
        console.log(`📁 Database: /opt/render/project/src/data/platform.db`);
      });
    });
} catch (err) {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
}