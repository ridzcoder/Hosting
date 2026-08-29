const fs = require('fs');
const path = require('path');

const BOTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'bots.json'), 'utf8')
);

function listBots() {
  return BOTS;
}

function getBotBySlug(slug) {
  return BOTS.find((b) => b.slug === slug) || null;
}

function rawManifestUrl(bot) {
  return `https://raw.githubusercontent.com/${bot.owner}/${bot.repo}/${bot.branch}/app.json`;
}

function tarballUrl(bot) {
  return `https://github.com/${bot.owner}/${bot.repo}/tarball/${bot.branch}`;
}

function cachedManifestPath(bot) {
  return path.join(__dirname, '..', '..', 'data', 'manifest-cache', `${bot.slug}.json`);
}

/**
 * Fetch a bot's app.json straight from GitHub so the deploy form always
 * reflects whatever the repo currently declares. Falls back to the
 * bundled copy (data/manifest-cache/) if the live fetch fails for any
 * reason — offline dev, GitHub rate limits, etc.
 */
async function getManifest(bot) {
  try {
    const res = await fetch(rawManifestUrl(bot), { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const manifest = await res.json();
      return { manifest, source: 'live' };
    }
  } catch (_err) {
    // fall through to cache
  }
  const cached = JSON.parse(fs.readFileSync(cachedManifestPath(bot), 'utf8'));
  return { manifest: cached, source: 'cache' };
}

/**
 * Normalize app.json's `env` block into a flat array the view can loop
 * over. SESSION_ID and APP_NAME are always guaranteed to be present (and
 * required) regardless of how the manifest itself flags them, since the
 * deploy form always needs both.
 */
function buildEnvFields(manifest) {
  const declared = manifest.env || {};
  const fields = Object.entries(declared).map(([key, def]) => ({
    key,
    description: def.description || '',
    default: def.value || '',
    required: key === 'SESSION_ID' ? true : Boolean(def.required),
  }));

  if (!fields.some((f) => f.key === 'SESSION_ID')) {
    fields.unshift({
      key: 'SESSION_ID',
      description: 'The paired WhatsApp session string for this bot.',
      default: '',
      required: true,
    });
  }

  return fields;
}

module.exports = { listBots, getBotBySlug, getManifest, buildEnvFields, tarballUrl };
