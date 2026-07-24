import { getNextQuotationNumber } from './quotationNumber.js';
import { isValidObjectId, sanitizeNumber, sanitizePlainText } from './sanitize.js';

const DRAFT = 'draft';
const SENT = 'sent';
const ACCEPTED = 'accepted';
const REJECTED = 'rejected';
const EXPIRED = 'expired';
const CONVERTED = 'converted';

const STATUSES = [DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED, CONVERTED];
const EDITABLE = [DRAFT, SENT, ACCEPTED, REJECTED];
const CONVERTIBLE = [SENT, ACCEPTED];
const TERMINAL = [EXPIRED, CONVERTED];

const SUPPORTED_CURRENCIES = ['NGN', 'GHS', 'ZAR', 'KES', 'USD', 'EUR'];
const MAX_ITEMS = 100;

export const DEFAULT_QUOTATION_TERMS = [
    'This quotation is valid until the date stated above.',
    '',
    'Prices quoted are subject to acceptance before the expiry date.',
    '',
    'This quotation is not a demand for payment. Payment becomes due only after this quotation has been accepted and converted into an invoice.',
    '',
    'Any changes to the scope of work or requested items may result in a revised quotation.',
].join('\n');

const ALLOWED_QUOTATION_FIELDS = [
    'clientId',
    'date',
    'validUntil',
    'items',
    'notes',
    'terms',
    'status',
    'currency',
    'taxRate',
    'discountType',
    'discountValue',
    'discount',
    'subtotal',
    'tax',
    'total',
];

function validationError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function sanitizeQuotationItem(item) {
    if (!item || typeof item !== 'object') {
        throw validationError('Invalid quotation line item.');
    }
    const unit = sanitizePlainText(item.unit, 40) || 'Qty';
    return {
        description: sanitizePlainText(item.description, 500),
        quantity: sanitizeNumber(item.quantity, { min: 0, max: 1_000_000, fallback: 0 }),
        rate: sanitizeNumber(item.rate, { min: 0, max: 1_000_000_000, fallback: 0 }),
        unit,
    };
}

export function sanitizeQuotationPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw validationError('Invalid quotation payload.');
    }

    const data = {};
    for (const key of ALLOWED_QUOTATION_FIELDS) {
        if (body[key] !== undefined) {
            data[key] = body[key];
        }
    }

    if (data.clientId !== undefined && data.clientId !== null && data.clientId !== '') {
        if (!isValidObjectId(String(data.clientId))) {
            throw validationError('Invalid client ID.');
        }
        data.clientId = String(data.clientId);
    }

    if (data.status !== undefined && !STATUSES.includes(data.status)) {
        throw validationError('Invalid quotation status.');
    }

    if (data.discountType !== undefined && !['fixed', 'percent'].includes(data.discountType)) {
        data.discountType = 'fixed';
    }

    if (Array.isArray(data.items)) {
        if (data.items.length > MAX_ITEMS) {
            throw validationError(`Quotations cannot have more than ${MAX_ITEMS} line items.`);
        }
        data.items = data.items.map(sanitizeQuotationItem);
    }

    data.notes = data.notes !== undefined ? sanitizePlainText(data.notes, 2000) : undefined;
    data.terms = data.terms !== undefined ? sanitizePlainText(data.terms, 5000) : undefined;
    data.date = data.date !== undefined ? sanitizePlainText(data.date, 32) : undefined;
    data.validUntil =
        data.validUntil !== undefined
            ? data.validUntil === null || data.validUntil === ''
                ? null
                : sanitizePlainText(data.validUntil, 32)
            : undefined;
    data.currency =
        data.currency !== undefined
            ? (() => {
                  const code = sanitizePlainText(data.currency, 8).toUpperCase();
                  if (!SUPPORTED_CURRENCIES.includes(code)) {
                      throw validationError(
                          `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}.`
                      );
                  }
                  return code;
              })()
            : undefined;

    if (data.taxRate !== undefined) {
        data.taxRate = sanitizeNumber(data.taxRate, { min: 0, max: 100, fallback: 0 });
    }
    if (data.discountValue !== undefined) {
        data.discountValue = sanitizeNumber(data.discountValue, {
            min: 0,
            max: 1_000_000_000,
            fallback: 0,
        });
    }
    if (data.discount !== undefined) {
        data.discount = sanitizeNumber(data.discount, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.subtotal !== undefined) {
        data.subtotal = sanitizeNumber(data.subtotal, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.tax !== undefined) {
        data.tax = sanitizeNumber(data.tax, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.total !== undefined) {
        data.total = sanitizeNumber(data.total, { min: 0, max: 1_000_000_000, fallback: 0 });
    }

    return data;
}

export function isDraftStatus(status) {
    return status === DRAFT;
}

export function assertQuotationUpdateAllowed(existing, payload) {
    const prev = existing.status || DRAFT;
    const next = payload.status ?? prev;

    if (prev === CONVERTED) {
        throw validationError('Converted quotations cannot be modified.');
    }

    if (prev === EXPIRED && next !== EXPIRED) {
        throw validationError('Expired quotations cannot be modified.');
    }

    if (TERMINAL.includes(prev) && next !== prev && prev === CONVERTED) {
        throw validationError('Converted quotations cannot change status.');
    }

    if (next === CONVERTED && !CONVERTIBLE.includes(prev) && prev !== CONVERTED) {
        throw validationError('Only sent or accepted quotations can be converted.');
    }
}

export function assertQuotationDeleteAllowed(existing) {
    const status = existing.status || DRAFT;
    if (status === CONVERTED) {
        throw validationError('Converted quotations cannot be deleted.');
    }
}

export function assertQuotationConvertible(existing) {
    const status = existing.status || DRAFT;
    if (status === CONVERTED) {
        throw validationError('This quotation has already been converted.');
    }
    if (status === EXPIRED) {
        throw validationError('Expired quotations cannot be converted.');
    }
    if (status === REJECTED) {
        throw validationError('Rejected quotations cannot be converted.');
    }
    if (status === DRAFT) {
        throw validationError('Finalize the quotation before converting it to an invoice.');
    }
    if (!CONVERTIBLE.includes(status)) {
        throw validationError('Only sent or accepted quotations can be converted.');
    }
}

export function normalizeQuotationPayload(body, { isCreate = false, existing = null } = {}) {
    const data = sanitizeQuotationPayload(body);
    let status = data.status || (isCreate ? DRAFT : SENT);

    if (isCreate) {
        status = data.status === DRAFT ? DRAFT : SENT;
        data.status = status;
        if (status === DRAFT) {
            delete data.quotationNumber;
        }
        if (data.terms === undefined || data.terms === null) {
            data.terms = DEFAULT_QUOTATION_TERMS;
        }
    }

    if (!isCreate && existing) {
        assertQuotationUpdateAllowed(existing, data);
        status = data.status ?? existing.status ?? DRAFT;
        data.status = status;
    }

    if (status === DRAFT) {
        delete data.quotationNumber;
        if (!data.clientId) {
            data.clientId = null;
        }
    } else if (status !== DRAFT && !data.validUntil && !existing?.validUntil) {
        // validUntil is recommended but not strictly required on every update
    }

    data.status = status;
    return data;
}

export async function assignQuotationNumber(payload, existing, userId) {
    const status = payload.status || SENT;
    const result = { ...payload };

    if (status === DRAFT) {
        delete result.quotationNumber;
        return result;
    }

    result.quotationNumber =
        existing?.quotationNumber || (await getNextQuotationNumber(userId));
    return result;
}

export function isFinalizingDraft(existing, payload) {
    return existing?.status === DRAFT && payload.status && payload.status !== DRAFT;
}

export { DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED, CONVERTED, STATUSES, EDITABLE, CONVERTIBLE };
