import React from 'react';
import { render } from '@react-email/render';
import { sendEmail } from '../sendEmail.js';
import AdminMessageEmail from '../templates/AdminMessageEmail.js';

function buildReact({ userName, preview, body, noReply, actionUrl, actionLabel }) {
    return React.createElement(AdminMessageEmail, {
        userName,
        preview,
        body,
        noReply,
        actionUrl,
        actionLabel,
    });
}

function buildPlainText({ body, noReply, actionUrl, actionLabel }) {
    const trimmed = String(body || '').trim().replace(/\n{2,}the waraqah team\.?$/i, '').trim();
    const parts = [trimmed];
    if (actionUrl && actionLabel) {
        parts.push(`${actionLabel}: ${actionUrl}`);
    }
    if (noReply) {
        parts.push('This email was sent from a no-reply address. Replies to this message are not monitored.');
    }
    return parts.filter(Boolean).join('\n\n');
}

export async function renderAdminMessageEmail({
    userName,
    preview,
    body,
    noReply,
    actionUrl,
    actionLabel,
}) {
    const react = buildReact({ userName, preview, body, noReply, actionUrl, actionLabel });
    const html = await render(react);
    const text = await render(react, { plainText: true });
    return { html, text };
}

/**
 * @param {object} params
 * @param {string} params.to
 * @param {string} [params.userName]
 * @param {string} params.subject
 * @param {string} [params.preview]
 * @param {string} params.body
 * @param {string} params.from
 * @param {string} [params.replyTo]
 * @param {string} [params.fromPreset]
 * @param {string} [params.actionUrl]
 * @param {string} [params.actionLabel]
 */
export async function sendAdminMessageEmail({
    to,
    userName,
    subject,
    preview,
    body,
    from,
    replyTo,
    fromPreset,
    actionUrl,
    actionLabel,
}) {
    const noReply = fromPreset === 'noreply';
    const react = buildReact({
        userName,
        preview,
        body,
        noReply,
        actionUrl,
        actionLabel,
    });
    return sendEmail({
        to,
        subject,
        from,
        replyTo,
        type: 'admin-message',
        react,
        text: buildPlainText({ body, noReply, actionUrl, actionLabel }),
    });
}
