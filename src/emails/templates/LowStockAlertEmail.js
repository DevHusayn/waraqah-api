import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import {
    buildStockAlertCopy,
    formatLowStockLine,
    formatOutOfStockLine,
} from '../helpers/stockAlert.js';

/**
 * Daily digest when tracked products are low on stock or out of stock.
 *
 * @param {object} props
 * @param {string} props.ownerName
 * @param {Array<{ name: string, quantityOnHand: number, lowStockThreshold?: number|null }>} props.products
 * @param {Array<{ name: string, quantityOnHand: number }>} [props.outOfStockProducts]
 * @param {string} props.productsUrl
 */
function renderProductRows(products, formatLine) {
    return products.map((product, index) =>
        React.createElement(
            React.Fragment,
            { key: product.name + index },
            React.createElement(Text, { style: emailStyles.detailLabel }, product.name),
            React.createElement(
                Text,
                {
                    style:
                        index === products.length - 1
                            ? emailStyles.detailValueLast
                            : emailStyles.detailValue,
                },
                formatLine(product),
            ),
        ),
    );
}

function renderProductSection(label, products, formatLine) {
    if (products.length === 0) return null;
    return React.createElement(
        React.Fragment,
        { key: label || 'products' },
        label
            ? React.createElement(
                Text,
                { style: { ...emailStyles.paragraph, fontWeight: 600, marginBottom: 0 } },
                label,
            )
            : null,
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            renderProductRows(products, formatLine),
        ),
    );
}

export default function LowStockAlertEmail({
    ownerName,
    products = [],
    outOfStockProducts = [],
    productsUrl,
}) {
    const copy = buildStockAlertCopy({ ownerName, products, outOfStockProducts });
    const showSectionLabels = products.length > 0 && outOfStockProducts.length > 0;

    return React.createElement(
        EmailLayout,
        { preview: copy.preview },
        React.createElement(Text, { style: emailStyles.heading }, copy.heading),
        React.createElement(Text, { style: emailStyles.paragraph }, copy.intro),
        renderProductSection(
            showSectionLabels ? 'Low stock' : '',
            products,
            formatLowStockLine,
        ),
        renderProductSection(
            showSectionLabels ? 'Out of stock' : '',
            outOfStockProducts,
            formatOutOfStockLine,
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: productsUrl, style: emailStyles.button }, 'View products'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'You receive this digest because low-stock email alerts are enabled in Settings → Notifications. '
            + copy.footer,
        ),
    );
}
