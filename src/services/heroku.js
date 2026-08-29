// Thin wrapper around Heroku's Platform API.
//
// We use the /app-setups endpoint — the same one behind every "Deploy to
// Heroku" button. Given a source tarball URL (the bot's repo) plus env
// var overrides (SESSION_ID, app name, etc.), Heroku itself reads the
// app.json baked into that tarball, provisions any addons/buildpacks it
// declares, creates the app, sets the config vars, and kicks off the
// build — so this file doesn't need to duplicate any of that logic.
//
// Docs: https://devcenter.heroku.com/articles/platform-api-reference#app-setup

const HEROKU_API = 'https://api.heroku.com';

function assertConfigured() {
  if (!process.env.HEROKU_API_KEY) {
    const err = new Error(
      'HEROKU_API_KEY is not set yet. Add it to your .env once you have it, then restart the server.'
    );
    err.code = 'HEROKU_NOT_CONFIGURED';
    throw err;
  }
}

function headers() {
  return {
    Accept: 'application/vnd.heroku+json; version=3',
    Authorization: `Bearer ${process.env.HEROKU_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function herokuRequest(pathname, options = {}) {
  const res = await fetch(`${HEROKU_API}${pathname}`, {
    ...options,
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.id || `Heroku API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.herokuBody = data;
    throw err;
  }
  return data;
}

/**
 * Kick off a deploy.
 * @param {string} sourceBlobUrl - tarball URL for the bot's repo/branch
 * @param {string} appName - desired Heroku app name (may be auto-suffixed by Heroku if taken)
 * @param {object} env - key/value overrides, e.g. { SESSION_ID: '...' }
 */
async function createAppSetup({ sourceBlobUrl, appName, env }) {
  assertConfigured();
  const body = {
    source_blob: { url: sourceBlobUrl },
    overrides: { env },
  };
  if (appName) body.app = { name: appName };
  return herokuRequest('/app-setups', { method: 'POST', body: JSON.stringify(body) });
}

/** Poll the status of a previously-created app setup. */
async function getAppSetup(appSetupId) {
  assertConfigured();
  return herokuRequest(`/app-setups/${appSetupId}`);
}

module.exports = { createAppSetup, getAppSetup, isConfigured: () => Boolean(process.env.HEROKU_API_KEY) };
