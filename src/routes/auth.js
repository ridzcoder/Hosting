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
  res.render('register', { title: 'Create account', ref: req.query.ref || '' });
});

router.post('/register', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  const refCode = String(req.body.ref || '').trim();

  if (!EMAIL_RE.test(email)) {
    flash(req, 'error', 'Enter a valid email address.');
    return res.redirect(`/register?ref=${encodeURIComponent(refCode)}`);
  }
  if (password.length < 8) {
    flash(req, 'error', 'Password must be at least 8 characters.');
    return res.redirect(`/register?ref=${encodeURIComponent(refCode)}`);
  }
  if (password !== confirmPassword) {
    flash(req, 'error', 'Passwords do not match.');
    return res.redirect(`/register?ref=${encodeURIComponent(refCode)}`);
  }

  const existing = db.getUserByEmail(email);
  if (existing && existing.verified) {
    flash(req, 'error', 'An account with that email already exists. Try logging in.');
    return res.redirect('/login');
  }

  let user = existing;
  if (!user) {
    const referrer = refCode ? db.getUserByReferralCode(refCode) : null;
    const passwordHash = await bcrypt.hash(password, 10);
    user = db.createUser({
      email,
      passwordHash,
      startingCoins: STARTER_COINS,
      referredBy: referrer ? referrer.id : null,
    });
  }

  const { code, expiresAt } = otp.buildOtp();
  db.setOtp(user.id, { code, expiresAt });
  await mailer.sendVerificationCode(email, code);

  req.session.pendingEmail = email;
  flash(req, 'success', `We sent a 6-digit code to ${email}.`);
  res.redirect('/verify');
});

// ── Verify ──────────────────────────────────────────────

router.get('/verify', (req, res) => {
  const email = req.query.email || req.session.pendingEmail || '';
  res.render('verify', { title: 'Verify your email', email });
});

router.post('/verify', authLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();

  const user = db.getUserByEmail(email);
  if (!user) {
    flash(req, 'error', 'We could not find that account. Please register again.');
    return res.redirect('/register');
  }
  if (otp.isExpired(user.otp_expires_at)) {
    flash(req, 'error', 'That code expired. Request a new one below.');
    return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
  }
  if (code !== user.otp_code) {
    flash(req, 'error', 'That code is incorrect.');
    return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
  }

  db.markVerified(user.id);
  db.clearOtp(user.id);
  db.rewardReferrerIfDue(user, REFERRAL_BONUS_COINS);
  delete req.session.pendingEmail;
  req.session.userId = user.id;
  flash(req, 'success', `Email verified — you've been credited ${STARTER_COINS} JC to get started.`);
  res.redirect('/dashboard');
});

router.post('/verify/resend', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.getUserByEmail(email);
  if (!user) {
    flash(req, 'error', 'We could not find that account.');
    return res.redirect('/register');
  }
  if (!otp.canResend(user.otp_last_sent_at)) {
    const wait = otp.secondsUntilResend(user.otp_last_sent_at);
    flash(req, 'error', `Please wait ${wait}s before requesting another code.`);
    return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
  }

  const { code, expiresAt } = otp.buildOtp();
  db.setOtp(user.id, { code, expiresAt });
  await mailer.sendVerificationCode(email, code);

  flash(req, 'success', 'New code sent.');
  res.redirect(`/verify?email=${encodeURIComponent(email)}`);
});

// ── Login / logout ──────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { title: 'Log in' });
});

router.post('/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = db.getUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    flash(req, 'error', 'Incorrect email or password.');
    return res.redirect('/login');
  }

  if (!user.verified) {
    const { code, expiresAt } = otp.buildOtp();
    db.setOtp(user.id, { code, expiresAt });
    await mailer.sendVerificationCode(email, code);
    req.session.pendingEmail = email;
    flash(req, 'error', 'Verify your email first — we just sent a fresh code.');
    return res.redirect('/verify');
  }

  req.session.userId = user.id;
  res.redirect(user.is_admin ? '/admin' : '/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
