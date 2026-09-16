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
