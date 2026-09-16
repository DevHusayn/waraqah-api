import { getNextPurchaseOrderNumber } from './purchaseOrderNumber.js';
import { isValidObjectId, sanitizeNumber, sanitizePlainText } from './sanitize.js';
import { isValidCurrencyCode } from './locale.js';

export const PO_DRAFT = 'draft';
export const PO_SENT = 'sent';
export const PO_PARTIAL = 'partial';
export const PO_RECEIVED = 'received';
export const PO_CANCELLED = 'cancelled';

export const PO_STATUSES = [PO_DRAFT, PO_SENT, PO_PARTIAL, PO_RECEIVED, PO_CANCELLED];
export const PO_RECEIVABLE = [PO_SENT, PO_PARTIAL];
export const PO_TERMINAL = [PO_RECEIVED, PO_CANCELLED];

const MAX_ITEMS = 100;

const ALLOWED_PO_FIELDS = [
    'supplierId',
    'date',
    'expectedDate',
    'items',
    'notes',
    'status',
    'currency',
    'exchangeRate',
    'subtotal',
    'total',
];

function validationError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function sanitizeItemProductId(productId) {
    if (productId === undefined || productId === null || productId === '') {
        return null;
    }
    if (!isValidObjectId(String(productId))) {
        throw validationError('Invalid product ID on line item.');
    }
    return String(productId);
}

function sanitizePurchaseOrderItem(item, { preserveReceived = false, existingItem = null } = {}) {
    if (!item || typeof item !== 'object') {
        throw validationError('Invalid purchase order line item.');
    }
    const unit = sanitizePlainText(item.unit, 40) || 'Qty';
    const quantity = sanitizeNumber(item.quantity, { min: 0, max: 1_000_000, fallback: 0 });
    const sanitized = {
        description: sanitizePlainText(item.description, 500),
        quantity,
        rate: sanitizeNumber(item.rate, { min: 0, max: 1_000_000_000, fallback: 0 }),
        unit,
        productId: sanitizeItemProductId(item.productId),
    };

    if (preserveReceived && existingItem) {
        const received = sanitizeNumber(existingItem.quantityReceived, {
            min: 0,
            max: quantity,
            fallback: 0,
        });
        sanitized.quantityReceived = Math.min(received, quantity);
    } else if (preserveReceived) {
        sanitized.quantityReceived = sanitizeNumber(item.quantityReceived, {
            min: 0,
            max: quantity,
            fallback: 0,
        });
    } else {
        sanitized.quantityReceived = 0;
    }

    return sanitized;
}

export function sanitizePurchaseOrderPayload(body, { preserveReceived = false, existingItems = [] } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw validationError('Invalid purchase order payload.');
    }

    const data = {};
    for (const key of ALLOWED_PO_FIELDS) {
        if (body[key] !== undefined) {
            data[key] = body[key];
        }
    }

    if (data.supplierId !== undefined && data.supplierId !== null && data.supplierId !== '') {
        if (!isValidObjectId(String(data.supplierId))) {
            throw validationError('Invalid supplier ID.');
        }
        data.supplierId = String(data.supplierId);
    } else if (data.supplierId === '') {
        data.supplierId = null;
    }

    if (data.status !== undefined && !PO_STATUSES.includes(data.status)) {
        throw validationError('Invalid purchase order status.');
    }

    if (Array.isArray(data.items)) {
        if (data.items.length > MAX_ITEMS) {
            throw validationError(`Purchase orders cannot have more than ${MAX_ITEMS} line items.`);
        }
        data.items = data.items.map((item, index) =>
            sanitizePurchaseOrderItem(item, {
                preserveReceived,
                existingItem: existingItems[index],
            })
        );
    }

    data.notes = data.notes !== undefined ? sanitizePlainText(data.notes, 2000) : undefined;
    data.date = data.date !== undefined ? sanitizePlainText(data.date, 32) : undefined;
    data.expectedDate =
        data.expectedDate !== undefined
            ? data.expectedDate === null || data.expectedDate === ''
                ? null
                : sanitizePlainText(data.expectedDate, 32)
            : undefined;
    data.currency =
        data.currency !== undefined
            ? (() => {
                  const code = sanitizePlainText(data.currency, 8).toUpperCase();
                  if (!isValidCurrencyCode(code)) {
                      throw validationError('Please choose a valid currency.');
                  }
                  return code;
              })()
            : undefined;
    if (data.exchangeRate !== undefined && data.exchangeRate !== null && data.exchangeRate !== '') {
        data.exchangeRate = sanitizeNumber(data.exchangeRate, {
            min: 0,
            max: 1_000_000_000,
            fallback: NaN,
        });
    }

    if (data.subtotal !== undefined) {
        data.subtotal = sanitizeNumber(data.subtotal, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.total !== undefined) {
        data.total = sanitizeNumber(data.total, { min: 0, max: 1_000_000_000, fallback: 0 });
    }

    return data;
}

export function isPurchaseOrderDraft(status) {
    return status === PO_DRAFT;
}

export function computePurchaseOrderStatus(items) {
    if (!Array.isArray(items) || items.length === 0) return PO_DRAFT;

    let totalOrdered = 0;
    let totalReceived = 0;

    for (const item of items) {
        const ordered = Number(item.quantity) || 0;
        const received = Number(item.quantityReceived) || 0;
        totalOrdered += ordered;
        totalReceived += Math.min(received, ordered);
    }

    if (totalOrdered <= 0) return PO_SENT;
    if (totalReceived <= 0) return PO_SENT;
    if (totalReceived >= totalOrdered) return PO_RECEIVED;
    return PO_PARTIAL;
}

export function assertPurchaseOrderUpdateAllowed(existing, payload) {
    const prev = existing.status || PO_DRAFT;
    const next = payload.status ?? prev;

    if (PO_TERMINAL.includes(prev)) {
        throw validationError('Received or cancelled purchase orders cannot be modified.');
    }

    if (prev !== PO_DRAFT && payload.items !== undefined) {
        throw validationError('Line items can only be edited while the purchase order is a draft.');
    }

    if (
        payload.status !== undefined
        && (next === PO_RECEIVED || next === PO_PARTIAL)
        && prev !== next
    ) {
        throw validationError('Use Receive stock to update received quantities and status.');
    }

    if (prev === PO_CANCELLED && next !== PO_CANCELLED) {
        throw validationError('Cancelled purchase orders cannot change status.');
    }
}

export function assertPurchaseOrderDeleteAllowed(existing) {
    const status = existing.status || PO_DRAFT;
    if (status === PO_PARTIAL || status === PO_RECEIVED) {
        throw validationError('Purchase orders with received stock cannot be deleted.');
    }
}

export function normalizePurchaseOrderPayload(body, { isCreate = false, existing = null } = {}) {
    const preserveReceived = Boolean(existing && existing.status !== PO_DRAFT);
    const data = sanitizePurchaseOrderPayload(body, {
        preserveReceived,
        existingItems: existing?.items || [],
    });

    if (isCreate && !data.status) {
        data.status = PO_DRAFT;
    }

    if (existing) {
        assertPurchaseOrderUpdateAllowed(existing, data);
    }

    if (data.status === PO_SENT && isCreate) {
        // placing order on create
    }

    return data;
}

export async function assignPurchaseOrderNumber(payload, existing, userId) {
    if (existing?.purchaseOrderNumber) {
        return { ...payload, purchaseOrderNumber: existing.purchaseOrderNumber };
    }
    const purchaseOrderNumber = await getNextPurchaseOrderNumber(userId);
    return { ...payload, purchaseOrderNumber };
}

export function sanitizeReceivePayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw validationError('Invalid receive payload.');
    }

    const lines = body.lines ?? body.receives ?? body.items;
    if (!Array.isArray(lines) || lines.length === 0) {
        throw validationError('At least one receive line is required.');
    }

    return lines.map((line) => {
        if (!line || typeof line !== 'object') {
            throw validationError('Invalid receive line.');
        }
        const lineIndex = Number(line.lineIndex ?? line.index);
        if (!Number.isInteger(lineIndex) || lineIndex < 0) {
            throw validationError('Each receive line must include a valid lineIndex.');
        }
        const quantity = sanitizeNumber(line.quantity, { min: 0, max: 1_000_000, fallback: 0 });
        if (quantity <= 0) {
            throw validationError('Receive quantity must be greater than zero.');
        }
        return { lineIndex, quantity };
    });
}
