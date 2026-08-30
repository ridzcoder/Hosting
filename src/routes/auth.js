// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const otp = require('../services/otp');
const mailer = require('../services/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STARTER_COINS = Number(process.env.STARTER_COINS || 2);
const REFERRAL_BONUS_COINS = Number(process.env.REFERRAL_BONUS_COINS || 5);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

// ── Register ────────────────────────────────────────────

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('register', { 
    title: 'Create account', 
    ref: req.query.ref || '' 
  });
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');
    const refCode = String(req.body.ref || '').trim();

    // Validate email
    if (!EMAIL_RE.test(email)) {
      flash(req, 'error', 'Enter a valid email address.');
      return res.redirect(`/register?ref=${encodeURIComponent(refCode)}`);
    }

    // Validate password
    if (password.length < 8) {
      flash(req, 'error', 'Password must be at least 8 characters.');
      return res.redirect(`/register?ref=${encodeURIComponent(refCode)}`);
    }
    if (password !== confirmPassword) {
      flash(req, 'error', 'Passwords do not match.');
      return res.redirect(`/register?ref=${encodeURIComponent(refCode)}`);
    }

    // Check if user exists
    const existing = await db.getUserByEmail(email);
    if (existing && existing.verified) {
      flash(req, 'error', 'An account with that email already exists. Try logging in.');
      return res.redirect('/login');
    }

    let user = existing;
    if (!user) {
      // Find referrer if referral code provided
      const referrer = refCode ? await db.getUserByReferralCode(refCode) : null;
      
      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);
      
      // Create user
      user = await db.createUser({
        email,
        passwordHash,
        startingCoins: STARTER_COINS,
        referredBy: referrer ? referrer.id : null,
      });
      
      console.log(`✅ New user registered: ${email}`);
    }

    // Generate OTP
    const { code, expiresAt } = otp.buildOtp();
    await db.setOtp(user.id, { code, expiresAt });
    
    // Send verification email
    try {
      await mailer.sendVerificationCode(email, code);
      console.log(`📧 Verification code sent to ${email}: ${code}`);
    } catch (err) {
      console.error('❌ Email error:', err.message);
      // Continue anyway - code is available in logs
    }

    req.session.pendingEmail = email;
    flash(req, 'success', `We sent a 6-digit code to ${email}.`);
    res.redirect('/verify');
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    flash(req, 'error', 'Registration failed. Please try again.');
    res.redirect('/register');
  }
});

// ── Verify ──────────────────────────────────────────────

router.get('/verify', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  const email = req.query.email || req.session.pendingEmail || '';
  res.render('verify', { 
    title: 'Verify your email', 
    email 
  });
});

router.post('/verify', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();

    console.log(`🔍 Verifying: ${email} with code: ${code}`);

    // Get user
    const user = await db.getUserByEmail(email);
    if (!user) {
      flash(req, 'error', 'We could not find that account. Please register again.');
      return res.redirect('/register');
    }

    // Debug logs
    console.log(`👤 User: ${user.email}`);
    console.log(`   Stored OTP: ${user.otp_code}`);
    console.log(`   Expires at: ${new Date(user.otp_expires_at).toISOString()}`);
    console.log(`   Current time: ${new Date().toISOString()}`);
    console.log(`   Is expired: ${otp.isExpired(user.otp_expires_at)}`);
    console.log(`   Time diff: ${user.otp_expires_at - Date.now()}ms`);

    // Check if OTP is expired
    if (otp.isExpired(user.otp_expires_at)) {
      flash(req, 'error', 'That code expired. Request a new one below.');
      return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
    }
    
    // Check if code matches
    if (code !== user.otp_code) {
      flash(req, 'error', 'That code is incorrect.');
      return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
    }

    // Mark user as verified
    await db.markVerified(user.id);
    await db.clearOtp(user.id);
    
    // Reward referrer if applicable
    await db.rewardReferrerIfDue(user, REFERRAL_BONUS_COINS);
    
    // Clear pending email from session
    delete req.session.pendingEmail;
    
    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    
    flash(req, 'success', `Email verified — you've been credited ${STARTER_COINS} JC to get started.`);
    res.redirect('/dashboard');
    
  } catch (error) {
    console.error('❌ Verification error:', error);
    flash(req, 'error', 'Verification failed. Please try again.');
    res.redirect('/verify');
  }
});

router.post('/verify/resend', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    
    // Get user
    const user = await db.getUserByEmail(email);
    if (!user) {
      flash(req, 'error', 'We could not find that account.');
      return res.redirect('/register');
    }
    
    // Check cooldown
    if (!otp.canResend(user.otp_last_sent_at)) {
      const wait = otp.secondsUntilResend(user.otp_last_sent_at);
      flash(req, 'error', `Please wait ${wait}s before requesting another code.`);
      return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
    }

    // Generate new OTP
    const { code, expiresAt } = otp.buildOtp();
    await db.setOtp(user.id, { code, expiresAt });
    
    // Send email
    try {
      await mailer.sendVerificationCode(email, code);
      console.log(`📧 New verification code sent to ${email}: ${code}`);
    } catch (err) {
      console.error('❌ Email error:', err.message);
    }

    flash(req, 'success', 'New code sent.');
    res.redirect(`/verify?email=${encodeURIComponent(email)}`);
    
  } catch (error) {
    console.error('❌ Resend error:', error);
    flash(req, 'error', 'Failed to resend code. Please try again.');
    res.redirect('/verify');
  }
});

// ── Login ──────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { 
    title: 'Log in',
    flash: req.session.flash || null
  });
  delete req.session.flash;
});

// src/routes/auth.js - Fix the login route
router.post('/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    console.log(`🔑 Login attempt: ${email}`);

    const user = await db.getUserByEmail(email);
    
    if (!user) {
      console.log('❌ User not found');
      flash(req, 'error', 'Incorrect email or password.');
      return res.redirect('/login');
    }

    if (!user.password_hash) {
      console.error(`⚠️ User ${email} has no password_hash`);
      flash(req, 'error', 'Account setup incomplete. Please contact support.');
      return res.redirect('/login');
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      console.log('❌ Invalid password');
      flash(req, 'error', 'Incorrect email or password.');
      return res.redirect('/login');
    }

    if (!user.verified) {
      console.log('⚠️ User not verified, sending OTP');
      const { code, expiresAt } = otp.buildOtp();
      await db.setOtp(user.id, { code, expiresAt });
      try {
        await mailer.sendVerificationCode(email, code);
      } catch (err) {
        console.error('❌ Email error:', err.message);
      }
      req.session.pendingEmail = email;
      flash(req, 'error', 'Verify your email first — we just sent a fresh code.');
      return res.redirect('/verify');
    }

    // ✅ Set session properly
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.isAdmin = user.is_admin || 0;
    
    // Save session explicitly
    req.session.save((err) => {
      if (err) {
        console.error('❌ Session save error:', err);
        flash(req, 'error', 'Login failed. Please try again.');
        return res.redirect('/login');
      }
      
      console.log(`✅ User logged in: ${user.email}, ID: ${user.id}`);
      console.log(`🔐 Session ID: ${req.sessionID}`);
      
      flash(req, 'success', `Welcome back, ${user.email}!`);
      res.redirect(user.is_admin ? '/admin' : '/dashboard');
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    flash(req, 'error', 'Login failed. Please try again.');
    res.redirect('/login');
  }
});

// ── Logout ──────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Logout error:', err);
    }
    res.redirect('/login');
  });
});

// ── Debug: Auto-verify (REMOVE IN PRODUCTION) ──────────
router.get('/debug/verify/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const user = await db.getUserByEmail(email);
    
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    await db.markVerified(user.id);
    await db.clearOtp(user.id);
    req.session.userId = user.id;
    
    res.send(`✅ ${email} verified! <a href="/dashboard">Go to dashboard</a>`);
  } catch (error) {
    console.error('❌ Debug verify error:', error);
    res.status(500).send('Error verifying user');
  }
});

module.exports = router;