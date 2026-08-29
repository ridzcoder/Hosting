const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_BOTS_PER_USER = Number(process.env.MAX_BOTS_PER_USER || 50);

router.get('/dashboard', requireAuth, (req, res) => {
  const deployments = db.listDeploymentsForUser(req.user.id);
  const stats = db.getDeploymentStatsForUser(req.user.id);
  const referralCount = db.countReferrals(req.user.id);
  const referralLink = `${process.env.BASE_URL || ''}/register?ref=${req.user.referral_code}`;

  res.render('dashboard', {
    title: 'Dashboard',
    deployments,
    stats,
    slotsUsed: stats.active + stats.pending,
    slotsTotal: MAX_BOTS_PER_USER,
    referralCount,
    referralLink,
    referralBonus: Number(process.env.REFERRAL_BONUS_COINS || 5),
  });
});

router.get('/topup', requireAuth, (req, res) => {
  res.render('topup', {
    title: 'Buy Coins',
    paymentLabel: process.env.PAYMENT_METHOD_LABEL || 'Mobile Money',
    paymentNumber: process.env.PAYMENT_NUMBER || '',
    supportEmail: process.env.SUPPORT_EMAIL || 'techkevin93@gmail.com',
  });
});

module.exports = router;
