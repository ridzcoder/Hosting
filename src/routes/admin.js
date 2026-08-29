const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use('/admin', requireAuth, requireAdmin);

router.get('/admin', (req, res) => {
  let lookup = null;
  const email = String(req.query.email || '').trim();
  if (email) {
    const found = db.getUserByEmail(email);
    if (found) {
      lookup = {
        ...found,
        referralCount: db.countReferrals(found.id),
        deployStats: db.getDeploymentStatsForUser(found.id),
      };
    }
  }
  res.render('admin', { title: 'Admin', searchedEmail: email, lookup });
});

router.post('/admin/add-coins', (req, res) => {
  const email = String(req.body.email || '').trim();
  const amount = parseInt(req.body.amount, 10);

  if (!email || !Number.isFinite(amount) || amount === 0) {
    req.session.flash = { type: 'error', message: 'Enter a valid email and a non-zero coin amount.' };
    return res.redirect(`/admin?email=${encodeURIComponent(email)}`);
  }

  const user = db.getUserByEmail(email);
  if (!user) {
    req.session.flash = { type: 'error', message: 'No user with that email.' };
    return res.redirect('/admin');
  }

  db.addCoins(user.id, amount);
  req.session.flash = { type: 'success', message: `${amount > 0 ? 'Added' : 'Removed'} ${Math.abs(amount)} JC ${amount > 0 ? 'to' : 'from'} ${email}.` };
  res.redirect(`/admin?email=${encodeURIComponent(email)}`);
});

module.exports = router;
