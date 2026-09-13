import BusinessInfo from '../../../models/CompanyInfo.js';
import { sendReceiptEmail } from '../senders/receiptEmail.js';
import { notifyOwnerInvoiceReceiptSent } from './ownerNotifications.js';
import {
    loadInvoiceEmailContext,
    buildReceiptUrl,
    formatPaymentMethod,
} from './invoiceContext.js';
import { ensureInvoicePublicToken } from '../../../utils/invoicePublicToken.js';
import { getInvoiceAmountPaid, getInvoiceBalanceDue } from '../../../utils/invoicePayments.js';
import { isReceiptDocument } from '../../../utils/receiptValidation.js';

export async function shouldAutoEmailReceipts(userId) {
    const info = await BusinessInfo.findOne({ userId }).select('autoEmailInvoices');
    return Boolean(info?.autoEmailInvoices);
}

export async function dispatchReceiptEmailToClient({
    receipt,
    userId,
    notifyOwner = true,
}) {
    if (!receipt.receiptNumber) {
        const err = new Error('This receipt does not have a receipt number.');
        err.status = 400;
        throw err;
    }

    await ensureInvoicePublicToken(receipt);
    const ctx = await loadInvoiceEmailContext(receipt, userId);

    const amountPaid = getInvoiceAmountPaid(receipt) || receipt.total;
    const balanceDue = getInvoiceBalanceDue(receipt);

    await sendReceiptEmail({
        to: ctx.to,
        customerName: ctx.customerName,
        invoiceNumber: receipt.invoiceNumber || undefined,
        receiptNumber: receipt.receiptNumber,
        amountPaid,
        totalAmount: receipt.total,
        balanceDue,
        currency: receipt.currency || 'NGN',
        paymentDate: receipt.datePaid || new Date(),
        paymentMethod: formatPaymentMethod(receipt.paymentMethod),
        businessName: ctx.businessName,
        replyTo: ctx.replyTo,
        branding: ctx.branding,
        receiptUrl: buildReceiptUrl(receipt),
    });

    receipt.clientReceiptEmailedAt = new Date();
    await receipt.save();

    if (notifyOwner) {
        await notifyOwnerInvoiceReceiptSent({
            userId,
            invoice: receipt,
            clientEmail: ctx.to,
            customerName: ctx.customerName,
        });
    }

    return { sentTo: ctx.to, publicUrl: buildReceiptUrl(receipt) };
}

export async function tryAutoEmailReceipt({ receipt, userId }) {
    if (receipt.status !== 'paid' || !receipt.clientId) return null;
    if (!isReceiptDocument(receipt)) return null;
    if (!(await shouldAutoEmailReceipts(userId))) return null;

    try {
        return await dispatchReceiptEmailToClient({
            receipt,
            userId,
            notifyOwner: true,
        });
    } catch (err) {
        console.error('[Waraqah Email] Auto-email receipt failed:', err.message);
        return null;
    }
}
