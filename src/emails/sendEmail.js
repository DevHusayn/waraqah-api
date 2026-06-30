import { render } from '@react-email/render';
import { assertResendConfigured, getDefaultFrom, getResendClient } from './resend.js';
import { isProductionEnvironment } from './config.js';
import {
    EmailNotConfiguredError,
    InvalidRecipientError,
    logEmailFailure,
    logEmailSuccess,
    normalizeResendError,
} from './errors.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRecipient(to) {
    const email = String(to || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
        throw new InvalidRecipientError(to);
    }
    return email;
}

/**
 * Core email sender — renders React Email templates and delivers via Resend.
 *
 * @param {object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject line
 * @param {React.ReactElement} options.react - React Email component tree
 * @param {string} [options.text] - Optional plain-text body (auto-generated if omitted)
 * @param {string} [options.replyTo] - Optional reply-to address
 * @param {string} options.type - Internal email type for logging
 * @param {object} [options.tags] - Optional Resend tags
 * @returns {Promise<{ sent: boolean, id?: string, devLogged?: boolean }>}
 */
export async function sendEmail({
    to,
    subject,
    react,
    text,
    type = 'transactional',
    replyTo,
    tags,
}) {
    const recipient = validateRecipient(to);
    const from = getDefaultFrom();

    if (!getResendClient()) {
        if (isProductionEnvironment()) {
            throw new EmailNotConfiguredError();
        }

        const previewText = text || await render(react, { plainText: true });
        console.log(`\n[Waraqah Email] Dev mode — ${type} (RESEND_API_KEY not set)`);
        console.log(`  To: ${recipient}`);
        console.log(`  Subject: ${subject}`);
        console.log(`  Body:\n${previewText}\n`);
        return { sent: false, devLogged: true };
    }

    assertResendConfigured();

    let html;
    let plainText;

    try {
        html = await render(react);
        plainText = text || await render(react, { plainText: true });
    } catch (renderErr) {
        logEmailFailure({ type, to: recipient, err: renderErr });
        throw renderErr;
    }

    const client = getResendClient();

    try {
        const payload = {
            from,
            to: recipient,
            subject,
            html,
            text: plainText,
        };

        if (replyTo) payload.reply_to = replyTo;
        if (tags) payload.tags = tags;

        const { data, error } = await client.emails.send(payload);

        if (error) {
            throw normalizeResendError({ error });
        }

        logEmailSuccess({ type, to: recipient, id: data?.id });
        return { sent: true, id: data?.id };
    } catch (err) {
        logEmailFailure({ type, to: recipient, err });
        throw err;
    }
}

export { getEmailErrorMessage } from './errors.js';
export { isResendConfigured as isEmailConfigured } from './config.js';
