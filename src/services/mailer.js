const nodemailer = require('nodemailer');

const isConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
let connectionVerified = false;

if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Add timeout and debug options
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development',
  });

  // Verify connection asynchronously
  transporter.verify((error) => {
    if (error) {
      console.error('❌ SMTP connection failed:', error.message);
      console.error('   Please check your SMTP credentials in .env');
      if (error.code === 'EAUTH') {
        console.error('   🔑 Authentication failed. If using Gmail:');
        console.error('   1. Enable 2-Factor Authentication');
        console.error('   2. Generate an App Password: https://myaccount.google.com/apppasswords');
        console.error('   3. Use the 16-char App Password (no spaces)');
      }
      connectionVerified = false;
    } else {
      console.log('✅ SMTP connection successful');
      console.log(`📧 Emails will be sent from: ${process.env.SMTP_FROM || 'no-reply@example.com'}`);
      connectionVerified = true;
    }
  });
} else {
  console.warn('⚠️ SMTP not configured. Emails will be printed to console.');
  console.warn('   Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env to enable email sending.');
}

const siteName = process.env.SITE_NAME || 'Bot Deploy';

async function sendVerificationCode(email, code) {
  const subject = `${siteName} verification code: ${code}`;
  const text = `Your ${siteName} verification code is ${code}. It expires in 10 minutes.`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 420px; margin: auto; padding: 20px; background: #f9f9f9; border-radius: 8px;">
      <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="margin: 0 0 10px 0; color: #1a1a2e;">${siteName}</h2>
        <p style="color: #555; margin: 10px 0;">Your verification code is:</p>
        <div style="text-align: center; margin: 25px 0;">
          <div style="display: inline-block; font-size: 36px; font-weight: bold; padding: 12px 30px; background: #f0f4f8; border-radius: 8px; letter-spacing: 8px; font-family: 'Courier New', monospace; color: #1a1a2e;">
            ${code}
          </div>
        </div>
        <p style="color: #666; font-size: 14px; margin: 10px 0;">This code expires in 10 minutes.</p>
        <p style="color: #999; font-size: 13px; margin: 20px 0 0 0;">If you didn't request this, you can ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #ccc; font-size: 11px; text-align: center; margin: 0;">${siteName}</p>
      </div>
    </div>
  `;

  if (!transporter || !isConfigured) {
    // Dev fallback — no SMTP configured yet. Print the code so the
    // register -> verify flow can still be tested end to end.
    console.log(`\n📧 [DEV MODE] Verification code for ${email}: ${code}`);
    console.log(`   (SMTP not configured - email would be sent in production)\n`);
    return { devMode: true, code };
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"${siteName}" <no-reply@ridzcoder@gmail.com>`,
      to: email,
      subject,
      text,
      html,
    });
    console.log(`✅ Verification email sent to ${email}`);
    return { devMode: false, success: true };
  } catch (error) {
    console.error('❌ Failed to send verification email:', error.message);
    if (error.code === 'EAUTH') {
      console.error('   🔑 Authentication error. Check your SMTP credentials.');
    }
    if (error.response) {
      console.error('   📧 SMTP Response:', error.response);
    }
    // Re-throw so the auth route can handle it
    throw error;
  }
}

// ── Test function ──────────────────────────────────────
async function testEmailConfig() {
  console.log('📧 Testing SMTP configuration...');
  console.log(`   SMTP_HOST: ${process.env.SMTP_HOST}`);
  console.log(`   SMTP_PORT: ${process.env.SMTP_PORT}`);
  console.log(`   SMTP_USER: ${process.env.SMTP_USER}`);
  console.log(`   SMTP_SECURE: ${process.env.SMTP_SECURE}`);
  console.log(`   Configured: ${isConfigured}`);

  if (!isConfigured) {
    console.log('   ⚠️ SMTP not configured. Running in dev mode.');
    return { success: true, devMode: true };
  }

  try {
    await transporter.verify();
    console.log('   ✅ SMTP connection successful!');
    return { success: true, devMode: false };
  } catch (error) {
    console.error('   ❌ SMTP connection failed:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { 
  sendVerificationCode, 
  isConfigured,
  testEmailConfig 
};