import React from 'react';
import { sendEmail } from '../sendEmail.js';
import LowStockAlertEmail from '../templates/LowStockAlertEmail.js';
import {
    buildStockAlertCopy,
    formatLowStockLine,
    formatOutOfStockLine,
} from '../helpers/stockAlert.js';

function textProductLines(label, products, formatLine) {
    if (products.length === 0) return [];
    const lines = products.map((product) => `- ${product.name}: ${formatLine(product)}`);
    return label ? [label, ...lines] : lines;
}

export async function sendLowStockAlertEmail({
    to,
    ownerName,
    products = [],
    outOfStockProducts = [],
    productsUrl,
}) {
    const copy = buildStockAlertCopy({ ownerName, products, outOfStockProducts });
    const showSectionLabels = products.length > 0 && outOfStockProducts.length > 0;

    return sendEmail({
        to,
        subject: copy.subject,
        type: 'owner-low-stock',
        react: React.createElement(LowStockAlertEmail, {
            ownerName,
            products,
            outOfStockProducts,
            productsUrl,
        }),
        text: [
            copy.textLead,
            '',
            ...textProductLines(
                showSectionLabels ? 'Low stock:' : '',
                products,
                formatLowStockLine,
            ),
            ...(showSectionLabels && outOfStockProducts.length > 0 ? [''] : []),
            ...textProductLines(
                showSectionLabels ? 'Out of stock:' : '',
                outOfStockProducts,
                formatOutOfStockLine,
            ),
            '',
            `View products: ${productsUrl}`,
            '',
            'You receive this digest because low-stock email alerts are enabled in Settings → Notifications.',
        ].join('\n'),
    });
}
