// server.js - Top of file
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

// Import db with async handling
const dbModule = require('./src/db');

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
app.get('/api/health', async (req, res) => {
  try {
    const health = await dbModule.checkDatabaseHealth();
    if (health.healthy) {
      res.json({ 
        status: 'healthy', 
        database: 'connected',
        path: health.path,
        vercel: health.vercel,
        environment: process.env.NODE_ENV || 'development'
      });
    } else {
      res.status(500).json({ 
        status: 'unhealthy', 
        error: health.error 
      });
    }
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

app.use((req, res) => res.status(404).render('404', { title: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { title: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
const siteName = process.env.SITE_NAME || 'Bot Deploy';

// Start server
async function startServer() {
  try {
    // Ensure database is initialized
    await dbModule.ensureInitialized();
    console.log('✅ Database ready');
    
    // Seed admin
    await seedAdmin();
    
    app.listen(PORT, () => {
      console.log(`${siteName} running on http://localhost:${PORT}`);
      console.log(`📁 Database: ${DB_PATH}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();