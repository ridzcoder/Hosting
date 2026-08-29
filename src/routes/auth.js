// src/routes/auth.js - Fix the login route

router.post('/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = db.getUserByEmail(email);
  
  // Check if user exists AND has a password_hash
  if (!user || !user.password_hash) {
    flash(req, 'error', 'Incorrect email or password.');
    return res.redirect('/login');
  }

  try {
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      flash(req, 'error', 'Incorrect email or password.');
      return res.redirect('/login');
    }
  } catch (err) {
    console.error('bcrypt error:', err);
    flash(req, 'error', 'Login failed. Please try again.');
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