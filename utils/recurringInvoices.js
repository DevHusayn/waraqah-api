import Invoice from '../models/Invoice.js';
import { reserveInvoiceCreation, releaseInvoiceCreation } from './invoiceLimits.js';
import { attachPublicTokenIfNeeded } from './invoicePublicToken.js';
import { tryAutoEmailInvoice } from '../src/emails/helpers/invoiceDispatch.js';
import { assignDocumentNumbers } from './invoiceValidation.js';
import { getNextInvoiceNumber } from './invoiceNumber.js';
import { snapshotItemUnitCosts } from './itemCostSnapshot.js';
import { applyInventoryTransition, getAllowOverselling } from './inventory.js';
import { getBusinessTimezone, getDatePartsInTimezone, toDateInputValue } from './timezone.js';
import {
    addFrequency,
    computeRecurringDueDate,
    shouldGenerateRecurrence,
} from './recurrence.js';
import { INVOICE_ONLY_FILTER } from './invoiceDocumentFilter.js';
import { applyClientSnapshot } from './clientSnapshot.js';

function cloneLineItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        rate: item.rate,
        unit: item.unit || 'Qty',
        productId: item.productId || null,
        unitCost: item.unitCost,
    }));
}

export function buildRecurringInvoiceChildPayload(template) {
    const date = template.recurringNextDate;
    const dueDate = computeRecurringDueDate(template.date, template.dueDate, date);

    return {
        userId: template.userId,
        clientId: template.clientId || null,
        clientName: template.clientName || null,
        clientCompany: template.clientCompany || null,
        documentType: 'invoice',
        date,
        dueDate,
        items: cloneLineItems(template.items),
        notes: template.notes || '',
        documentFooter: template.documentFooter || '',
        clientAdditionalInfo: template.clientAdditionalInfo || '',
        status: 'pending',
        currency: template.currency,
        taxRate: template.taxRate,
        discountType: template.discountType || 'fixed',
        discountValue: template.discountValue || 0,
        discount: template.discount || 0,
        subtotal: template.subtotal,
        tax: template.tax,
        total: template.total,
        exchangeRate: template.exchangeRate,
        baseCurrency: template.baseCurrency,
        baseSubtotal: template.baseSubtotal,
        baseTax: template.baseTax,
        baseDiscount: template.baseDiscount,
        baseTotal: template.baseTotal,
        baseAmountPaid: 0,
        isRecurring: false,
        recurringFrequency: undefined,
        recurringEndDate: null,
        recurringNextDate: null,
        recurringSourceId: template._id,
    };
}

export function todayInTimezone(timeZone, now = new Date()) {
    const parts = getDatePartsInTimezone(timeZone, now);
    return toDateInputValue(parts.year, parts.month, parts.day);
}

export function nextTemplateSchedule(template, { ended = false } = {}) {
    if (ended) {
        return {
            isRecurring: false,
            recurringNextDate: null,
        };
    }
    return {
        isRecurring: true,
        recurringNextDate: addFrequency(template.recurringNextDate, template.recurringFrequency),
    };
}

/** Generate child invoices from active recurring templates. */
export async function generateRecurringInvoices(now = new Date()) {
    const recurringTemplates = await Invoice.find({
        isRecurring: true,
        status: { $ne: 'draft' },
        recurringNextDate: { $ne: null },
        ...INVOICE_ONLY_FILTER,
    }).lean();

    let createdCount = 0;
    const timezoneCache = new Map();

    for (const template of recurringTemplates) {
        const userKey = String(template.userId);
        if (!timezoneCache.has(userKey)) {
            timezoneCache.set(userKey, await getBusinessTimezone(template.userId));
        }
        const today = todayInTimezone(timezoneCache.get(userKey), now);

        if (!shouldGenerateRecurrence({
            nextDate: template.recurringNextDate,
            endDate: template.recurringEndDate,
            today,
        })) {
            continue;
        }

        try {
            await reserveInvoiceCreation(template.userId);
        } catch (err) {
            if (err.code === 'INVOICE_LIMIT_REACHED') continue;
            throw err;
        }

        const payload = buildRecurringInvoiceChildPayload(template);
        try {
            await applyClientSnapshot(payload, template.userId, template);
            const numbered = await assignDocumentNumbers(
                payload,
                null,
                template.userId,
                { getNextInvoiceNumber }
            );
            attachPublicTokenIfNeeded(numbered);
            numbered.items = await snapshotItemUnitCosts(template.userId, numbered.items);
            const invoice = await Invoice.create(numbered);
            const allowOverselling = await getAllowOverselling(template.userId);
            await applyInventoryTransition({
                userId: template.userId,
                prevDoc: null,
                nextDoc: invoice,
                allowOverselling,
            });
            createdCount += 1;
            tryAutoEmailInvoice({ invoice, userId: template.userId });

            const advanced = addFrequency(template.recurringNextDate, template.recurringFrequency);
            const ended = Boolean(
                template.recurringEndDate
                && advanced
                && advanced > template.recurringEndDate
            );
            const schedule = nextTemplateSchedule(template, { ended });
            await Invoice.updateOne(
                { _id: template._id },
                ended
                    ? {
                        $set: { isRecurring: false, recurringNextDate: null },
                        $unset: { recurringFrequency: 1 },
                    }
                    : { $set: { recurringNextDate: schedule.recurringNextDate } }
            );
        } catch (err) {
            await releaseInvoiceCreation(template.userId);
            console.error('[Recurring invoices] Failed to generate from', template._id, err);
        }
    }

    return { createdCount };
}
