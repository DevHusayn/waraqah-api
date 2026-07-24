import React from 'react';
import { sendEmail } from '../sendEmail.js';
import QuotationEmail from '../templates/QuotationEmail.js';
import { formatCurrency, formatDate } from '../formatters.js';
import { buildClientEmailBranding, getClientEmailFromAddress } from '../helpers/clientEmailBranding.js';

export async function sendQuotationEmail({
    to,
    customerName,
    quotationNumber,
    amount,
    currency = 'NGN',
    validUntil,
    quotationUrl,
    businessName,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const formattedAmount = formatCurrency(amount, currency);

    return sendEmail({
        to,
        from: getClientEmailFromAddress(brand.businessName),
        subject: `Quotation ${quotationNumber} from ${brand.businessName}`,
        type: 'quotation',
        react: React.createElement(QuotationEmail, {
            customerName,
            quotationNumber,
            amount,
            currency,
            validUntil,
            quotationUrl,
            businessName: brand.businessName,
            branding: brand,
        }),
        text: [
            `Quotation ${quotationNumber} from ${brand.businessName}`,
            '',
            `Estimated total: ${formattedAmount}`,
            ...(validUntil ? [`Valid until: ${formatDate(validUntil)}`] : []),
            '',
            `View quotation: ${quotationUrl}`,
        ].join('\n'),
    });
}
