import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { BRAND } from '../config.js';
import { splitBodyParagraphs } from '../helpers/adminMessage.js';

const NO_REPLY_NOTICE =
    'This email was sent from a no-reply address. Replies to this message are not monitored.';

const greetingStyle = {
    ...emailStyles.paragraph,
    fontWeight: 700,
    color: BRAND.text,
};

function bodyWithoutSignOff(paragraphs) {
    if (!paragraphs.length) return paragraphs;
    if (/^the waraqah team\.?$/i.test(paragraphs[paragraphs.length - 1])) {
        return paragraphs.slice(0, -1);
    }
    return paragraphs;
}

/**
 * @param {object} props
 * @param {string} [props.userName]
 * @param {string} [props.preview]
 * @param {string} props.body
 * @param {boolean} [props.noReply]
 * @param {string} [props.actionUrl]
 * @param {string} [props.actionLabel]
 */
export default function AdminMessageEmail({
    userName,
    preview,
    body,
    noReply = false,
    actionUrl = '',
    actionLabel = '',
}) {
    const greetingName = userName?.trim() || 'there';
    const paragraphs = bodyWithoutSignOff(splitBodyParagraphs(body));
    const previewText = String(preview || paragraphs[0] || 'A message from Waraqah').trim().slice(0, 140);
    const hasButton = Boolean(actionUrl && actionLabel);

    return React.createElement(
        EmailLayout,
        { preview: previewText },
        React.createElement(
            Text,
            { style: greetingStyle },
            `Hi ${greetingName},`,
        ),
        ...(paragraphs.length > 0
            ? paragraphs.map((paragraph, index) =>
                React.createElement(
                    Text,
                    {
                        key: `p-${index}`,
                        style: {
                            ...emailStyles.paragraph,
                            whiteSpace: 'pre-wrap',
                            margin:
                                !noReply && !hasButton && index === paragraphs.length - 1
                                    ? 0
                                    : emailStyles.paragraph.margin,
                        },
                    },
                    paragraph,
                ),
            )
            : []),
        hasButton
            ? React.createElement(
                Section,
                { style: emailStyles.buttonSection },
                React.createElement(Button, { href: actionUrl, style: emailStyles.button }, actionLabel),
            )
            : null,
        noReply
            ? React.createElement(Text, { style: { ...emailStyles.muted, margin: 0 } }, NO_REPLY_NOTICE)
            : null,
    );
}
