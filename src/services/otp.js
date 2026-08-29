const OTP_TTL_MS = 10 * 60 * 1000; // codes are valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // must wait 60s between resends

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

function buildOtp() {
  return {
    code: generateCode(),
    expiresAt: Date.now() + OTP_TTL_MS,
  };
}

function isExpired(expiresAt) {
  return !expiresAt || Date.now() > expiresAt;
}

function canResend(lastSentAt) {
  if (!lastSentAt) return true;
  return Date.now() - lastSentAt > RESEND_COOLDOWN_MS;
}

function secondsUntilResend(lastSentAt) {
  if (!lastSentAt) return 0;
  const remaining = RESEND_COOLDOWN_MS - (Date.now() - lastSentAt);
  return Math.max(0, Math.ceil(remaining / 1000));
}

module.exports = { buildOtp, isExpired, canResend, secondsUntilResend };
