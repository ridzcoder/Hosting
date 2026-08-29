// src/services/mailer.js
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
    // Brevo specific settings
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    // Brevo uses STARTTLS on port 587
    tls: {
      rejectUnauthorized: false
    }
  });

  // Verify connection on startup
  transporter.verify((error) => {
    if (error) {
      console.error('❌ SMTP connection failed:', error.message);
      console.error('   Please check your SMTP credentials');
    } else {
      console.log('✅ Brevo SMTP connection successful!');
      console.log(`📧 Sending emails from: ${process.env.SMTP_FROM}`);
    }
  });
} else {
  console.warn('⚠️ SMTP not configured. Emails will be printed to console.');
}

const siteName = process.env.SITE_NAME || 'Bot Deploy';

async function sendVerificationCode(email, code) {
  const subject = `${siteName} verification code: ${code}`;
  const text = `Your ${siteName} verification code is ${code}. It expires in 10 minutes.`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f6f9fc; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .header { text-align: center; margin-bottom: 30px; }
        .brand { font-size: 24px; font-weight: bold; color: #1a1a2e; }
        .brand span { color: #4CAF50; }
        h2 { color: #1a1a2e; margin-top: 0; font-size: 22px; }
        p { color: #555; line-height: 1.6; margin: 10px 0; }
        .code-container { text-align: center; margin: 30px 0; }
        .code { 
          display: inline-block; 
          font-size: 42px; 
          font-weight: bold; 
          padding: 15px 35px; 
          background: #f0f4f8; 
          border-radius: 10px; 
          letter-spacing: 12px; 
          font-family: 'Courier New', monospace;
          color: #1a1a2e;
        }
        .info { color: #777; font-size: 14px; margin-top: 20px; }
        .divider { border: none; border-top: 1px solid #e8ecf1; margin: 25px 0; }
        .footer { text-align: center; color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="header">
            <div class="brand">${siteName}<span>.</span></div>
          </div>
          
          <h2>Verify Your Email</h2>
          <p>Enter this code to verify your email address:</p>
          
          <div class="code-container">
            <div class="code">${code}</div>
          </div>
          
          <p>This code will expire in <strong>10 minutes</strong>.</p>
          <p class="info">If you didn't request this, please ignore this email.</p>
          
          <hr class="divider">
          <div class="footer">
            ${siteName} &bull; Secure Email Verification
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!transporter || !isConfigured) {
    console.log(`\n📧 [DEV MODE] Verification code for ${email}: ${code}\n`);
    return { devMode: true };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"${siteName}" <no-reply@example.com>`,
      to: email,
      subject,
      text,
      html,
    });
    console.log(`✅ Verification email sent to ${email}`);
    console.log(`   Message ID: ${info.messageId}`);
    return { devMode: false, success: true };
  } catch (error) {
    console.error('❌ Failed to send verification email:', error.message);
    if (error.response) {
      console.error('   📧 SMTP Response:', error.response);
    }
    // Fallback: print code so user can still login
    console.log(`📧 [FALLBACK] Verification code for ${email}: ${code}`);
    throw error;
  }
}

module.exports = { sendVerificationCode, isConfigured };