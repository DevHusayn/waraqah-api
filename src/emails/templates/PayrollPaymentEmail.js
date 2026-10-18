import React from 'react';
import { Section, Text } from '@react-email/components';
import ClientEmailLayout, { createClientEmailStyles } from '../layouts/ClientEmailLayout.js';
import { buildClientEmailBranding } from '../helpers/clientEmailBranding.js';

export default function PayrollPaymentEmail({
    firstName,
    staffName,
    role,
    businessName,
    periodLabel,
    paymentDateLabel,
    amountLabel,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const emailStyles = createClientEmailStyles(brand);
    const greetingName = firstName?.trim() || 'there';

    return React.createElement(
        ClientEmailLayout,
        {
            preview: `Salary payment confirmation for ${periodLabel} from ${brand.businessName}.`,
            branding: brand,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Salary payment confirmation'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hello ${greetingName},`,
        ),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `This confirms that your salary for ${periodLabel} has been recorded as paid.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Employer'),
            React.createElement(Text, { style: emailStyles.detailValue }, brand.businessName),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Name'),
            React.createElement(Text, { style: emailStyles.detailValue }, staffName),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Role'),
            React.createElement(Text, { style: emailStyles.detailValue }, role),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Pay period'),
            React.createElement(Text, { style: emailStyles.detailValue }, periodLabel),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Payment date'),
            React.createElement(Text, { style: emailStyles.detailValue }, paymentDateLabel),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, amountLabel),
        ),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            'This message is a confirmation of payment for your records.',
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            `If anything looks incorrect, reply to this email or contact ${brand.businessName}.`,
        ),
    );
}
