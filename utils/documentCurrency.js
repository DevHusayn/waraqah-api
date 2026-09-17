import mongoose from 'mongoose';
import BusinessInfo from '../models/CompanyInfo.js';
import { APP_CURRENCY, normalizeCurrency } from './locale.js';

export const DOCUMENT_BOOKS_FIELDS =
    'currency exchangeRate baseCurrency baseSubtotal baseTax baseDiscount baseTotal baseAmountPaid';

export function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

export function isValidExchangeRate(rate) {
    const n = Number(rate);
    return Number.isFinite(n) && n > 0;
}

function recordedAmountPaid(doc) {
    const recorded = roundMoney(doc?.amountPaid);
    if (recorded > 0) return recorded;
    if (doc?.status === 'paid') return roundMoney(doc?.total);
    return 0;
}

function validationError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export function computeBaseAmounts({
    total = 0,
    subtotal = 0,
    tax = 0,
    discount = 0,
    amountPaid = 0,
    exchangeRate = 1,
} = {}) {
    const rate = Number(exchangeRate);
    const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0;
    return {
        baseSubtotal: roundMoney((Number(subtotal) || 0) * safeRate),
        baseTax: roundMoney((Number(tax) || 0) * safeRate),
        baseDiscount: roundMoney((Number(discount) || 0) * safeRate),
        baseTotal: roundMoney((Number(total) || 0) * safeRate),
        baseAmountPaid: roundMoney((Number(amountPaid) || 0) * safeRate),
    };
}

export async function getBusinessCurrencyForUser(userId) {
    if (!userId || mongoose.connection.readyState !== 1) return APP_CURRENCY;
    const info = await BusinessInfo.findOne({ userId }).select('defaultCurrency').lean();
    return normalizeCurrency(info?.defaultCurrency);
}

export function applyDocumentBaseAmounts(payload, { businessCurrency, amountPaid = 0 } = {}) {
    const docCurrency = normalizeCurrency(payload?.currency);
    const baseCurrency = normalizeCurrency(businessCurrency);
    payload.currency = docCurrency;
    payload.baseCurrency = baseCurrency;

    if (docCurrency === baseCurrency) {
        payload.exchangeRate = 1;
        Object.assign(
            payload,
            computeBaseAmounts({
                subtotal: payload.subtotal,
                tax: payload.tax,
                discount: payload.discount,
                total: payload.total,
                amountPaid,
                exchangeRate: 1,
            })
        );
        return payload;
    }

    if (!isValidExchangeRate(payload.exchangeRate)) {
        throw validationError(
            `Enter how many ${baseCurrency} equal 1 ${docCurrency}.`
        );
    }

    const rate = Number(payload.exchangeRate);
    payload.exchangeRate = rate;
    Object.assign(
        payload,
        computeBaseAmounts({
            subtotal: payload.subtotal,
            tax: payload.tax,
            discount: payload.discount,
            total: payload.total,
            amountPaid,
            exchangeRate: rate,
        })
    );
    return payload;
}

export async function attachDocumentBaseAmounts(userId, payload, { amountPaid = 0 } = {}) {
    if (!payload || (payload.total === undefined && payload.subtotal === undefined)) {
        return payload;
    }
    const businessCurrency = await getBusinessCurrencyForUser(userId);
    return applyDocumentBaseAmounts(payload, { businessCurrency, amountPaid });
}

export function syncDocumentBaseAmountPaid(doc) {
    if (!doc) return doc;
    const amountPaid = recordedAmountPaid(doc);
    const docCurrency = normalizeCurrency(doc.currency);
    const baseCurrency = doc.baseCurrency ? normalizeCurrency(doc.baseCurrency) : docCurrency;

    if (docCurrency === baseCurrency) {
        doc.baseAmountPaid = amountPaid;
        if (!isValidExchangeRate(doc.exchangeRate)) doc.exchangeRate = 1;
        if (!doc.baseCurrency) doc.baseCurrency = docCurrency;
        if (doc.baseTotal == null) doc.baseTotal = roundMoney(doc.total);
        return doc;
    }

    if (isValidExchangeRate(doc.exchangeRate)) {
        doc.baseAmountPaid = roundMoney(amountPaid * Number(doc.exchangeRate));
    }
    return doc;
}

export function exchangeRateForBooks(doc, businessCurrency = APP_CURRENCY) {
    const books = normalizeCurrency(businessCurrency);
    const docCurrency = normalizeCurrency(doc?.currency);
    if (docCurrency === books) return 1;
    const baseCurrency = doc?.baseCurrency ? normalizeCurrency(doc.baseCurrency) : null;
    if (baseCurrency === books && isValidExchangeRate(doc?.exchangeRate)) {
        return Number(doc.exchangeRate);
    }
    return null;
}

export function projectDocIntoBooks(doc, businessCurrency = APP_CURRENCY) {
    const rate = exchangeRateForBooks(doc, businessCurrency);
    if (rate == null) return null;
    const books = normalizeCurrency(businessCurrency);
    if (rate === 1) {
        return { ...doc, currency: books };
    }

    const scale = (value) => roundMoney((Number(value) || 0) * rate);
    return {
        ...doc,
        currency: books,
        exchangeRate: 1,
        baseCurrency: books,
        subtotal: doc.baseSubtotal != null ? roundMoney(doc.baseSubtotal) : scale(doc.subtotal),
        tax: doc.baseTax != null ? roundMoney(doc.baseTax) : scale(doc.tax),
        discount: doc.baseDiscount != null ? roundMoney(doc.discount) : scale(doc.discount),
        total: doc.baseTotal != null ? roundMoney(doc.baseTotal) : scale(doc.total),
        amountPaid:
            doc.baseAmountPaid != null
                ? roundMoney(doc.baseAmountPaid)
                : scale(recordedAmountPaid(doc)),
        items: Array.isArray(doc.items)
            ? doc.items.map((item) => ({
                  ...item,
                  rate: scale(item.rate),
              }))
            : doc.items,
    };
}

export function projectDocsIntoBooks(docs, businessCurrency = APP_CURRENCY) {
    return (docs || []).map((doc) => projectDocIntoBooks(doc, businessCurrency)).filter(Boolean);
}

export function roundExchangeRate(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 1e8) / 1e8;
}

export function booksRebaseCorrectionFactor(oldRate, newRate) {
    if (!isValidExchangeRate(oldRate) || !isValidExchangeRate(newRate)) return null;
    if (roundExchangeRate(oldRate) === roundExchangeRate(newRate)) return 1;
    const factor = Number(newRate) / Number(oldRate);
    return Number.isFinite(factor) && factor > 0 ? factor : null;
}

function scaleItemUnitCosts(items, rate) {
    if (!Array.isArray(items)) return { items, changed: false };
    let changed = false;
    const next = items.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const cost = Number(item.unitCost);
        if (!Number.isFinite(cost) || cost === 0) return item;
        changed = true;
        return { ...item, unitCost: roundMoney(cost * rate) };
    });
    return { items: next, changed };
}

function pickBooksPatch(patch, kind) {
    if (kind === 'purchaseOrder') {
        const { exchangeRate, baseCurrency, baseSubtotal, baseTotal } = patch;
        return { exchangeRate, baseCurrency, baseSubtotal, baseTotal };
    }
    if (kind === 'quotation') {
        const { exchangeRate, baseCurrency, baseSubtotal, baseTax, baseDiscount, baseTotal } = patch;
        return { exchangeRate, baseCurrency, baseSubtotal, baseTax, baseDiscount, baseTotal };
    }
    return patch;
}

/**
 * Rebase a document's books fields from one business currency into another.
 * Client-facing `currency` and face amounts are left unchanged.
 */
export function rebaseDocumentBooks(doc, { fromCurrency, toCurrency, rate, kind = 'invoice' } = {}) {
    if (!doc) return null;
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    const rebaseRate = Number(rate);
    if (from === to || !isValidExchangeRate(rebaseRate)) return null;

    const docCurrency = normalizeCurrency(doc.currency || from);
    const baseCurrency = doc.baseCurrency ? normalizeCurrency(doc.baseCurrency) : docCurrency;
    if (baseCurrency === to) return null;

    const amountPaid = recordedAmountPaid(doc);

    if (docCurrency === to) {
        const { items, changed } = scaleItemUnitCosts(doc.items, rebaseRate);
        const patch = {
            exchangeRate: 1,
            baseCurrency: to,
            ...computeBaseAmounts({
                subtotal: doc.subtotal,
                tax: doc.tax,
                discount: doc.discount,
                total: doc.total,
                amountPaid,
                exchangeRate: 1,
            }),
        };
        if (kind === 'invoice' && changed) patch.items = items;
        return pickBooksPatch(patch, kind);
    }

    if (docCurrency !== from && !isValidExchangeRate(doc.exchangeRate)) {
        return null;
    }

    const previousRate =
        docCurrency === from || !isValidExchangeRate(doc.exchangeRate)
            ? 1
            : Number(doc.exchangeRate);
    const newRate = roundExchangeRate(previousRate * rebaseRate);
    if (!isValidExchangeRate(newRate)) return null;

    const hasStoredBase = doc.baseTotal != null || doc.baseSubtotal != null;
    const baseFields =
        hasStoredBase && (baseCurrency === from || !doc.baseCurrency)
            ? {
                  baseSubtotal: roundMoney((Number(doc.baseSubtotal) || 0) * rebaseRate),
                  baseTax: roundMoney((Number(doc.baseTax) || 0) * rebaseRate),
                  baseDiscount: roundMoney((Number(doc.baseDiscount) || 0) * rebaseRate),
                  baseTotal: roundMoney((Number(doc.baseTotal) || Number(doc.total) || 0) * rebaseRate),
                  baseAmountPaid: roundMoney(
                      (doc.baseAmountPaid != null ? Number(doc.baseAmountPaid) : amountPaid) *
                          rebaseRate
                  ),
              }
            : computeBaseAmounts({
                  subtotal: doc.subtotal,
                  tax: doc.tax,
                  discount: doc.discount,
                  total: doc.total,
                  amountPaid,
                  exchangeRate: newRate,
              });

    const { items, changed } = scaleItemUnitCosts(doc.items, rebaseRate);
    const patch = {
        exchangeRate: newRate,
        baseCurrency: to,
        ...baseFields,
    };
    if (kind === 'invoice' && changed) patch.items = items;
    return pickBooksPatch(patch, kind);
}

/**
 * Restate books after a mistaken conversion rate. Face amounts stay put.
 */
export function correctDocumentBooksRate(
    doc,
    { fromCurrency, toCurrency, oldRate, newRate, kind = 'invoice' } = {}
) {
    if (!doc) return null;
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    const factor = booksRebaseCorrectionFactor(oldRate, newRate);
    if (from === to || factor == null || factor === 1) return null;

    const docCurrency = normalizeCurrency(doc.currency || from);
    const baseCurrency = doc.baseCurrency ? normalizeCurrency(doc.baseCurrency) : docCurrency;
    if (baseCurrency !== to) return null;

    if (docCurrency === to) {
        const { items, changed } = scaleItemUnitCosts(doc.items, factor);
        if (!changed || kind !== 'invoice') return null;
        return { items };
    }

    const nextExchangeRate =
        docCurrency === from || !isValidExchangeRate(doc.exchangeRate)
            ? roundExchangeRate(newRate)
            : roundExchangeRate(Number(doc.exchangeRate) * factor);
    if (!isValidExchangeRate(nextExchangeRate)) return null;

    const amountPaid = recordedAmountPaid(doc);
    const { items, changed } = scaleItemUnitCosts(doc.items, factor);
    const patch = {
        exchangeRate: nextExchangeRate,
        baseCurrency: to,
        ...computeBaseAmounts({
            subtotal: doc.subtotal,
            tax: doc.tax,
            discount: doc.discount,
            total: doc.total,
            amountPaid,
            exchangeRate: nextExchangeRate,
        }),
    };
    if (kind === 'invoice' && changed) patch.items = items;
    return pickBooksPatch(patch, kind);
}
