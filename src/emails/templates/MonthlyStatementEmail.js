import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.ownerName
 * @param {string} props.periodLabel
 * @param {object} props.totals
 * @param {string} props.statementsUrl
 */
export default function MonthlyStatementEmail({
    ownerName,
    periodLabel,
    totals,
    statementsUrl,
    currency = 'NGN',
}) {
    const greetingName = ownerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        { preview: `Your ${periodLabel} billing statement is attached.` },
        React.createElement(Text, { style: emailStyles.heading }, 'Your monthly statement'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, your ${periodLabel} billing statement is attached to this email.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Period'),
            React.createElement(Text, { style: emailStyles.detailValue }, periodLabel),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Total billed'),
            React.createElement(
                Text,
                { style: emailStyles.detailValue },
                formatCurrency(totals.total, currency),
            ),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Documents in period'),
            React.createElement(
                Text,
                { style: emailStyles.detailValueLast },
                String(totals.documentCount),
            ),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: statementsUrl, style: emailStyles.button }, 'View in Waraqah'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'You receive this email because monthly statement delivery is enabled in Settings → Notifications.',
        ),
    );
}
