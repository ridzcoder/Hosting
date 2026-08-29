const express = require('express');
const db = require('../db');
const botsService = require('../services/bots');
const heroku = require('../services/heroku');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const APP_NAME_RE = /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/; // Heroku app-name rules, 3-30 chars
const MAX_BOTS_PER_USER = Number(process.env.MAX_BOTS_PER_USER || 50);

function flash(req, type, message) {
  req.session.flash = { type, message };
}

// ── Step: pick a bot ─────────────────────────────────────

router.get('/deploy', requireAuth, (req, res) => {
  const bots = botsService.listBots().map((bot) => ({
    ...bot,
    activeCount: db.countActiveDeploymentsForBot(bot.slug),
  }));
  res.render('deploy-picker', { title: 'Deploy a bot', bots });
});

// ── Step: configure ──────────────────────────────────────

router.get('/deploy/:slug', requireAuth, async (req, res) => {
  const bot = botsService.getBotBySlug(req.params.slug);
  if (!bot) return res.status(404).render('404', { title: 'Not found' });

  const { manifest } = await botsService.getManifest(bot);
  const envFields = botsService.buildEnvFields(manifest);

  res.render('deploy', {
    title: `Deploy ${bot.name}`,
    bot,
    manifest,
    envFields,
    canAfford: req.user.coins >= bot.costCoins,
    sessionHelperUrl: process.env.SESSION_HELPER_URL || '',
  });
});

// ── Step: submit ─────────────────────────────────────────

router.post('/deploy/:slug', requireAuth, async (req, res) => {
  const bot = botsService.getBotBySlug(req.params.slug);
  if (!bot) return res.status(404).render('404', { title: 'Not found' });

  const stats = db.getDeploymentStatsForUser(req.user.id);
  if (stats.active + stats.pending >= MAX_BOTS_PER_USER) {
    flash(req, 'error', `You've used all ${MAX_BOTS_PER_USER} of your bot slots.`);
    return res.redirect(`/deploy/${bot.slug}`);
  }

  const appName = String(req.body.app_name || '').trim().toLowerCase();
  if (!APP_NAME_RE.test(appName)) {
    flash(req, 'error', 'App name must be 3-30 characters: lowercase letters, numbers and dashes, starting with a letter.');
    return res.redirect(`/deploy/${bot.slug}`);
  }

  const { manifest } = await botsService.getManifest(bot);
  const envFields = botsService.buildEnvFields(manifest);

  const env = {};
  for (const field of envFields) {
    const value = String(req.body[`env_${field.key}`] || '').trim();
    if (field.required && !value) {
      flash(req, 'error', `${field.key} is required.`);
      return res.redirect(`/deploy/${bot.slug}`);
    }
    if (value) env[field.key] = value;
  }

  if (!heroku.isConfigured()) {
    flash(req, 'error', 'The platform admin has not connected a Heroku API key yet — deploys are disabled for now.');
    return res.redirect(`/deploy/${bot.slug}`);
  }

  // Reserve the coins before calling Heroku so two simultaneous deploys
  // can't both pass the balance check and overdraw the account.
  const charged = db.deductCoinsIfSufficient(req.user.id, bot.costCoins);
  if (!charged) {
    flash(req, 'error', `You need ${bot.costCoins} JC to deploy ${bot.name} — you have ${req.user.coins}.`);
    return res.redirect('/topup');
  }

  try {
    const setup = await heroku.createAppSetup({
      sourceBlobUrl: botsService.tarballUrl(bot),
      appName,
      env,
    });

    const deployment = db.createDeployment({
      userId: req.user.id,
      botSlug: bot.slug,
      appName: setup.app?.name || appName,
      herokuAppSetupId: setup.id,
      coinsCharged: bot.costCoins,
    });

    res.redirect(`/deploy/status/${deployment.id}`);
  } catch (err) {
    // Deploy never reached Heroku (or Heroku rejected it outright) — refund.
    db.addCoins(req.user.id, bot.costCoins);
    flash(req, 'error', `Heroku rejected the deploy: ${err.message}`);
    res.redirect(`/deploy/${bot.slug}`);
  }
});

// ── Step: status ─────────────────────────────────────────

router.get('/deploy/status/:id', requireAuth, (req, res) => {
  const deployment = db.getDeploymentById(req.params.id);
  if (!deployment || deployment.user_id !== req.user.id) {
    return res.status(404).render('404', { title: 'Not found' });
  }
  const bot = botsService.getBotBySlug(deployment.bot_slug);
  res.render('deploy-status', { title: 'Deploying', deployment, bot });
});

// Polled by the client-side script on the status page.
router.get('/api/deploy/status/:id', requireAuth, async (req, res) => {
  const deployment = db.getDeploymentById(req.params.id);
  if (!deployment || deployment.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (deployment.status === 'pending' && deployment.heroku_app_setup_id) {
    try {
      const setup = await heroku.getAppSetup(deployment.heroku_app_setup_id);
      const buildStatus = setup.build?.status; // 'pending' | 'succeeded' | 'failed'
      const setupStatus = setup.status; // 'pending' | 'succeeded' | 'failed'

      if (setupStatus === 'succeeded') {
        db.updateDeploymentStatus(deployment.id, {
          status: 'succeeded',
          herokuAppUrl: setup.app?.web_url || null,
        });
      } else if (setupStatus === 'failed' || buildStatus === 'failed') {
        // Refund on failure — the user didn't get a working bot out of it.
        db.addCoins(deployment.user_id, deployment.coins_charged);
        db.updateDeploymentStatus(deployment.id, {
          status: 'failed',
          failureMessage: setup.failure_message || 'Build failed on Heroku.',
        });
      }
    } catch (err) {
      // Transient Heroku API hiccup — leave status as pending, client will retry.
    }
  }

  const fresh = db.getDeploymentById(deployment.id);
  res.json({
    status: fresh.status,
    appName: fresh.app_name,
    appUrl: fresh.heroku_app_url,
    failureMessage: fresh.failure_message,
  });
});

module.exports = router;
