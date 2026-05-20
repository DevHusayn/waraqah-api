import nodemailer from 'nodemailer';

const APP_NAME = 'Waraqah';

export function isEmailConfigured() {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransporter() {
    if (!isEmailConfigured()) return null;

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

function buildResetEmailHtml(resetUrl) {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="background:#0284c7;padding:24px;text-align:center;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;">${APP_NAME}</span>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">Reset your password</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">
            We received a request to reset the password for your account. Click the button below to choose a new password. This link expires in 1 hour.
          </p>
          <a href="${resetUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:10px;">
            Reset password
          </a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">
            If you did not request this, you can ignore this email. Your password will not change.
          </p>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all;">
            Or copy this link: ${resetUrl}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Sends password reset email. In development without SMTP, logs the link to the console.
 * @returns {{ sent: boolean }}
 */
export async function sendPasswordResetEmail({ to, resetUrl }) {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const subject = `Reset your ${APP_NAME} password`;
    const html = buildResetEmailHtml(resetUrl);
    const text = `Reset your ${APP_NAME} password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`;

    if (!isEmailConfigured()) {
        if (process.env.NODE_ENV === 'production') {
            const err = new Error('EMAIL_NOT_CONFIGURED');
            err.code = 'EMAIL_NOT_CONFIGURED';
            throw err;
        }
        console.log(`\n[${APP_NAME}] Password reset (dev, no SMTP):\n  ${to}\n  ${resetUrl}\n`);
        return { sent: false };
    }

    const transporter = createTransporter();
    await transporter.sendMail({
        from: from ? `"${APP_NAME}" <${from}>` : APP_NAME,
        to,
        subject,
        html,
        text,
    });

    return { sent: true };
}
