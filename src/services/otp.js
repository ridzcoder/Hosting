// src/services/otp.js
const crypto = require('crypto');

const OTP_TTL_MS = 10 * 60 * 1000; // codes are valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // must wait 60s between resends

// Use Date.now() consistently
function getCurrentTime() {
  return Date.now(); // Returns milliseconds since epoch
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

function buildOtp() {
  const now = getCurrentTime();
  return {
    code: generateCode(),
    expiresAt: now + OTP_TTL_MS,
    createdAt: now,
  };
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const now = getCurrentTime();
  const expired = now > expiresAt;
  if (expired) {
    console.log(`⏰ OTP expired: ${new Date(now).toISOString()} > ${new Date(expiresAt).toISOString()}`);
  }
  return expired;
}

function canResend(lastSentAt) {
  if (!lastSentAt) return true;
  const now = getCurrentTime();
  const diff = now - lastSentAt;
  const can = diff > RESEND_COOLDOWN_MS;
  if (!can) {
    console.log(`⏰ Cannot resend: ${diff}ms < ${RESEND_COOLDOWN_MS}ms`);
  }
  return can;
}

function secondsUntilResend(lastSentAt) {
  if (!lastSentAt) return 0;
  const now = getCurrentTime();
  const remaining = RESEND_COOLDOWN_MS - (now - lastSentAt);
  return Math.max(0, Math.ceil(remaining / 1000));
}

module.exports = { buildOtp, isExpired, canResend, secondsUntilResend };