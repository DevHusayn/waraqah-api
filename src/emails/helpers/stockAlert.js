function productName(product) {
    return product?.name?.trim() || 'A product';
}

function plural(count, singular, pluralForm) {
    return count === 1 ? singular : pluralForm;
}

/**
 * Subject, preview, and body copy for the daily stock digest.
 * Low-stock and out-of-stock lists are separate so the email can
 * stay a low-stock alert, become an out-of-stock alert, or cover both.
 */
export function buildStockAlertCopy({
    ownerName,
    products = [],
    outOfStockProducts = [],
} = {}) {
    const greetingName = ownerName?.trim() || 'there';
    const lowCount = products.length;
    const outCount = outOfStockProducts.length;
    const total = lowCount + outCount;
    const hasLow = lowCount > 0;
    const hasOut = outCount > 0;

    if (hasLow && hasOut) {
        return {
            heading: 'Stock alert',
            subject: `Stock alert — ${total} products need attention`,
            preview: `${lowCount} ${plural(lowCount, 'product is', 'products are')} low on stock and ${outCount} ${plural(outCount, 'is', 'are')} out of stock.`,
            intro: `Hi ${greetingName}, ${lowCount} tracked ${plural(lowCount, 'product is', 'products are')} at or below ${plural(lowCount, 'its', 'their')} low-stock threshold, and ${outCount} ${plural(outCount, 'is', 'are')} out of stock.`,
            textLead: `${lowCount} ${plural(lowCount, 'product is', 'products are')} low on stock and ${outCount} ${plural(outCount, 'is', 'are')} out of stock.`,
            footer: 'We send at most one summary per day while products remain low or out of stock.',
        };
    }

    if (hasOut) {
        const only = outOfStockProducts[0];
        return {
            heading: 'Out of stock alert',
            subject: outCount === 1
                ? `Out of stock: ${productName(only)}`
                : `Out of stock alert — ${outCount} products need restocking`,
            preview: outCount === 1
                ? `${productName(only)} is out of stock.`
                : `${outCount} products are out of stock.`,
            intro: outCount === 1
                ? `Hi ${greetingName}, one tracked product in your catalog has no units on hand.`
                : `Hi ${greetingName}, ${outCount} tracked products in your catalog have no units on hand.`,
            textLead: outCount === 1
                ? `${productName(only)} is out of stock.`
                : `${outCount} products are out of stock.`,
            footer: 'We send at most one summary per day while products remain out of stock.',
        };
    }

    const only = products[0];
    return {
        heading: 'Low stock alert',
        subject: lowCount === 1
            ? `Low stock: ${productName(only)}`
            : `Low stock alert — ${lowCount} products need attention`,
        preview: lowCount === 1
            ? `${productName(only)} is low on stock.`
            : `${lowCount} products are low on stock.`,
        intro: lowCount === 1
            ? `Hi ${greetingName}, one tracked product in your catalog is at or below its low-stock threshold.`
            : `Hi ${greetingName}, ${lowCount} tracked products in your catalog are at or below their low-stock thresholds.`,
        textLead: lowCount === 1
            ? `${productName(only)} is low on stock.`
            : `${lowCount} products are low on stock.`,
        footer: 'We send at most one summary per day while products remain low.',
    };
}

export function formatLowStockLine(product) {
    return `${product.quantityOnHand ?? 0} on hand · alert at ${product.lowStockThreshold ?? 0} or below`;
}

export function formatOutOfStockLine(product) {
    return `${product.quantityOnHand ?? 0} on hand · out of stock`;
}
