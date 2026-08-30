// src/routes/dashboard.js
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_BOTS_PER_USER = Number(process.env.MAX_BOTS_PER_USER || 50);

// ── Dashboard ──────────────────────────────────────────
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    // Get user data (already attached by middleware)
    const user = req.user;
    
    // Get deployments and stats
    const deployments = await db.listDeploymentsForUser(user.id) || [];
    const stats = await db.getDeploymentStatsForUser(user.id) || { total: 0, active: 0, inactive: 0, pending: 0 };
    const referralCount = await db.countReferrals(user.id) || 0;
    
    // Build referral link
    const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'https://hosting-xzkg.onrender.com';
    const referralLink = `${baseUrl}/register?ref=${user.referral_code || ''}`;

    // Calculate slots based on plan
    let slotsTotal = MAX_BOTS_PER_USER;
    if (user.plan === 'pro') slotsTotal = 10;
    else if (user.plan === 'premium') slotsTotal = 25;
    else if (user.plan === 'enterprise') slotsTotal = 100;
    
    const slotsUsed = (stats.active || 0) + (stats.pending || 0);

    res.render('dashboard', {
      title: 'Dashboard',
      user: user,
      deployments: deployments,
      stats: stats,
      slotsUsed: slotsUsed,
      slotsTotal: slotsTotal,
      referralCount: referralCount,
      referralLink: referralLink,
      referralBonus: Number(process.env.REFERRAL_BONUS_COINS || 5),
      siteName: process.env.SITE_NAME || 'JEX HOST',
      flash: req.session.flash || null,
      currentPath: req.path
    });
    
    // Clear flash after rendering
    delete req.session.flash;
    
  } catch (error) {
    console.error('❌ Dashboard error:', error);
    req.session.flash = { type: 'error', message: 'Failed to load dashboard' };
    res.redirect('/dashboard');
  }
});

// ── Top Up Page ────────────────────────────────────────
router.get('/topup', requireAuth, async (req, res) => {
  try {
    res.render('topup', {
      title: 'Buy Coins',
      user: req.user,
      paymentLabel: process.env.PAYMENT_METHOD_LABEL || 'Mobile Money',
      paymentNumber: process.env.PAYMENT_NUMBER || '',
      supportEmail: process.env.SUPPORT_EMAIL || 'techkevin93@gmail.com',
      siteName: process.env.SITE_NAME || 'JEX HOST',
      flash: req.session.flash || null,
      currentPath: req.path
    });
    
    delete req.session.flash;
    
  } catch (error) {
    console.error('❌ Topup error:', error);
    req.session.flash = { type: 'error', message: 'Failed to load page' };
    res.redirect('/dashboard');
  }
});

// ── Deployment Status Page ────────────────────────────
router.get('/deploy/status/:id', requireAuth, async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.id);
    const deployment = await db.getDeploymentById(deploymentId);
    
    if (!deployment) {
      req.session.flash = { type: 'error', message: 'Deployment not found' };
      return res.redirect('/dashboard');
    }

    // Check if deployment belongs to user
    if (deployment.user_id !== req.user.id) {
      req.session.flash = { type: 'error', message: 'Access denied' };
      return res.redirect('/dashboard');
    }

    res.render('deployment-status', {
      title: 'Deployment Status',
      deployment: deployment,
      user: req.user,
      siteName: process.env.SITE_NAME || 'JEX HOST',
      flash: req.session.flash || null,
      currentPath: req.path
    });
    
    delete req.session.flash;
    
  } catch (error) {
    console.error('❌ Deployment status error:', error);
    req.session.flash = { type: 'error', message: 'Failed to load deployment' };
    res.redirect('/dashboard');
  }
});

module.exports = router;