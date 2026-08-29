const nodemailer = require('nodemailer');

const isConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const siteName = process.env.SITE_NAME || 'Bot Deploy';

async function sendVerificationCode(email, code) {
  const subject = `${siteName} verification code: ${code}`;
  const text = `Your ${siteName} verification code is ${code}. It expires in 10 minutes.`;
  const html = `
    <div style="font-family:sans-serif;max-width:420px;margin:auto">
      <h2 style="margin-bottom:0">${siteName}</h2>
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:4px">${code}</p>
      <p style="color:#666">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  `;

  if (!transporter) {
    // Dev fallback — no SMTP configured yet. Print the code so the
    // register -> verify flow can still be tested end to end.
    console.log(`\n[mailer] SMTP not configured — verification code for ${email}: ${code}\n`);
    return { devMode: true };
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || `"${siteName}" <no-reply@example.com>`,
    to: email,
    subject,
    text,
    html,
  });
  return { devMode: false };
}

module.exports = { sendVerificationCode, isConfigured };
