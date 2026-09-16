export const APP_CURRENCY = 'NGN';
export const DEFAULT_COUNTRY = 'NG';

const NON_CASH_CURRENCY_CODES = new Set([
    'XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'XSU', 'XUA',
    'XBA', 'XBB', 'XBC', 'XBD', 'XXX', 'XTS',
]);

export function isValidCurrencyCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) return false;
    if (NON_CASH_CURRENCY_CODES.has(normalized)) return false;
    try {
        new Intl.NumberFormat('en', { style: 'currency', currency: normalized }).format(0);
        return true;
    } catch {
        return false;
    }
}

export function normalizeCurrency(code) {
    const normalized = String(code || '').trim().toUpperCase();
    return isValidCurrencyCode(normalized) ? normalized : APP_CURRENCY;
}

export function isValidCountryCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return false;
    try {
        const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(normalized);
        return Boolean(name) && name.toUpperCase() !== normalized;
    } catch {
        return false;
    }
}

export function normalizeCountry(code) {
    const normalized = String(code || '').trim().toUpperCase();
    return isValidCountryCode(normalized) ? normalized : DEFAULT_COUNTRY;
}

export function assertValidCurrency(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!isValidCurrencyCode(normalized)) {
        const err = new Error('Please choose a valid currency.');
        err.status = 400;
        throw err;
    }
    return normalized;
}

export function assertValidCountry(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!isValidCountryCode(normalized)) {
        const err = new Error('Please choose a valid country.');
        err.status = 400;
        throw err;
    }
    return normalized;
}
