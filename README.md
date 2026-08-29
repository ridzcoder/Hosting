# Bot Deploy Platform

A client portal for deploying **Vesper-Xmd**, **Jexploit Bot**, and
**Nexus-1MD** to Heroku through the Heroku Platform API. Users register,
verify their email with a 6-digit code, log in, land on a dashboard with
their coin balance, pick a bot, fill in its config, and the platform
deploys it via Heroku's `/app-setups` endpoint — the same mechanism
behind every "Deploy to Heroku" button.

## What's here

- **Auth**: register → email OTP → verify → login, sessions via cookies
- **Coin economy (JC = Jexploit Coins)**: new users start with `STARTER_COINS`
  (default 2) — enough to cover one deploy each of Vesper-Xmd and Jexploit
  Bot (1 JC apiece). Nexus-1MD costs more (8 JC by default) since it's
  the "extra" bot beyond the two included ones. Edit `costCoins` per bot
  in `data/bots.json` to change pricing.
- **Referrals**: every user has a referral link (shown on the dashboard,
  with a copy button). When someone registers through it and verifies
  their email, the referrer is credited `REFERRAL_BONUS_COINS` (default
  5) — credited on verify, not on raw registration, so it can't be farmed
  with junk signups.
- **Buy Coins**: a manual flow — there's no payment gateway wired up.
  Users pay to the number in `PAYMENT_NUMBER` / `PAYMENT_METHOD_LABEL`,
  then email proof to `SUPPORT_EMAIL`. An admin credits their account
  from the admin panel.
- **Admin**: real login (not a shared secret) — `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` in `.env` seed an admin account on first boot. Admins
  land on `/admin`, can look up any user by email, and add or remove JC.
- **Dashboard**: coin balance, total/active/inactive bot counts, a bot
  "slots" progress bar (`MAX_BOTS_PER_USER`, default 50), recent
  deployments, and the referral panel.
- **Deploy wizard**: reads each bot's real `app.json` straight from
  GitHub at request time (falls back to a bundled cached copy if that
  fetch fails), and builds the config form from whatever `env` block it
  finds — so if a bot's `app.json` changes upstream, the form updates on
  its own. `SESSION_ID` and the Heroku app name are always present
  regardless of what the manifest declares. Shows the deploy cost, and
  blocks (server-side, not just visually) if the user can't afford it.
- **Heroku integration**: `src/services/heroku.js` wraps `/app-setups`
  (create + poll). The status page polls every 2.5s and shows a live
  build console until it succeeds or fails. Coins are deducted up front
  and **refunded automatically** if Heroku rejects the deploy or the
  build fails.

## What's *not* stored

Session IDs and any other config values are forwarded straight to
Heroku's config-vars for the new app and are **not** written to this
platform's own database — only deployment metadata (app name, bot,
status, coins charged, timestamps) is kept. Treat a session ID like a
password: it's enough to fully control that WhatsApp account.

## About the credentials you gave me

A few things worth knowing about how these were handled:

- **Heroku API key** and the **admin password** are only in `.env`,
  which is in `.gitignore` — never in a tracked/example file, never
  hardcoded in source. The admin password is hashed with bcrypt before
  it ever touches the database (`src/services/seedAdmin.js`); the
  plaintext only exists transiently in `.env` and in memory while
  hashing.
- Both of those values were typed directly into our chat, which means
  they're sitting in this conversation's history in plaintext. That's
  outside what this codebase can control — if you ever export, share, or
  screenshot this conversation, treat both as exposed and **rotate them**
  (a new Heroku API key from Account Settings, a new admin password) once
  you're set up. Not urgent, just worth doing at some point.
- The payment number is treated as ordinary public business info (it's
  meant to be shown to your users), not a secret — it lives in `.env`
  purely so it's easy to edit in one place, same as the site name.

## Setup

```bash
cd bot-deploy
npm install
```

A `.env` is already included with what you gave me wired in (Heroku key,
admin login, payment number). Things still worth doing before you go
live:

- `SMTP_*` — still blank, so verification codes print to the server
  console for now. Add real SMTP credentials (Gmail app password, Brevo,
  Resend, Zoho, etc.) when you're ready to actually email codes.
- `BASE_URL` — update this once you have a real domain; it's used to
  build referral links.
- `SESSION_HELPER_URL` — optional link shown on the deploy page pointing
  at wherever your users get a SESSION_ID from (your existing pairing
  site). Leave blank to hide it.

Run it:

```bash
npm start
# or, for auto-restart on file changes:
npm run dev
```

Visit `http://localhost:3000`. Log in with your `ADMIN_EMAIL` /
`ADMIN_PASSWORD` to land on the admin panel.

## Deploying this platform itself

Heroku's dyno filesystem is ephemeral **and read-only outside `/tmp`**.
This project uses SQLite (`data/platform.db`) for zero-config local
storage, but on Heroku that file either gets wiped on every
restart/deploy or fails to open at all — this is the exact
`SqliteError: attempt to write a readonly database` / `unable to open
database file` failure mode, in case you've run into it before with
another app on Heroku. Before going live on Heroku, swap `src/db.js` for
Heroku Postgres (the `pg` package); every route only calls the functions
exported from that one file, so the swap stays contained there. Running
this platform on a host with a persistent disk (a VPS, Railway, etc.)
sidesteps the issue entirely if you'd rather not touch the DB layer yet.

Separately: Heroku has not offered free dynos or a free Postgres tier
since November 2022 — the Heroku costs for whichever bots get deployed
land on the account behind `HEROKU_API_KEY`, same as your platform's own
hosting if you put it on Heroku too.

## Project layout

```
server.js                  entry point, session + view engine, seeds the admin account
src/db.js                  SQLite schema + queries (swap for Postgres later)
src/services/heroku.js     Heroku Platform API (/app-setups)
src/services/bots.js       bot registry + live app.json fetch/parse
src/services/mailer.js     nodemailer, with a console-log dev fallback
src/services/otp.js        6-digit code generation/expiry/cooldown
src/services/seedAdmin.js  creates/promotes the admin account on boot
src/middleware/auth.js     requireAuth, requireAdmin
src/routes/auth.js         register (+ referral capture), verify (+ referral reward), login, logout
src/routes/dashboard.js    stats dashboard, buy-coins page
src/routes/deploy.js       bot picker, deploy form, deploy trigger + coin charge/refund, status polling
src/routes/admin.js        admin panel: user lookup, add/remove coins
src/views/                 EJS templates
src/public/                CSS + client-side JS
data/bots.json             the three bots (name, repo, branch, icon, costCoins)
data/manifest-cache/       cached app.json per bot, used if the live fetch fails
```

## Adding another bot later

Add an entry to `data/bots.json` (slug, name, owner, repo, branch, icon,
costCoins) and, optionally, a cached fallback manifest in
`data/manifest-cache/`. Nothing else needs to change — the deploy route,
form, and picker grid are already generic over the bot registry.

## Not built yet (flagged, not forgotten)

Some of this is from the "Prince Host"-style reference screenshots —
I matched the parts that were a clean fit for what's already built;
these would each be a real feature to scope separately:

- **Recurring "X JC/day" maintenance billing.** Right now a deploy is a
  one-time charge. Auto-charging daily (and deciding what happens when a
  user can't cover the renewal — pause the bot? delete the Heroku app?)
  is a meaningfully bigger feature with real money-handling edge cases,
  so I left it out rather than half-build it. Say the word if you want
  it and I'll design it properly.
- **Multiple payment gateways.** Only the one payment method you gave me
  is wired up. Happy to add more once you have the details for each.
- Real payment automation (Stripe/Paystack/Flutterwave-style — right now
  topping up is manual: pay, email proof, admin credits it)
- A "My Profile" page, notifications, and a community/chat tab
- Password reset flow
- Streaming the *real* Heroku build log (the status page currently shows
  setup-level state, not raw build output — Heroku exposes that via the
  build's `output_stream_url` if you want it later)
