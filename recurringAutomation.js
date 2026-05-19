// In-app recurring invoice automation using node-cron
import cron from 'node-cron';
import Invoice from './models/Invoice.js';
import { getInvoiceUsageForUser } from './utils/invoiceLimits.js';

// This function is adapted from generateRecurringInvoices.js
async function generateRecurringInvoices() {
    const recurringTemplates = await Invoice.find({
        isRecurring: true,
        recurringEndDate: { $ne: null },
    });
    const now = new Date();
    for (const template of recurringTemplates) {
        const lastInvoice = await Invoice.findOne({
            isRecurring: false,
            userId: template.userId,
            clientId: template.clientId,
            invoiceNumber: { $regex: `^${template.invoiceNumber}-` },
        }).sort({ createdAt: -1 });
        let nextDate = new Date(template.date);
        if (lastInvoice) {
            nextDate = new Date(lastInvoice.date);
        }
        let increment;
        switch (template.recurringFrequency) {
            case 'weekly': increment = 7; break;
            case 'bi-weekly': increment = 14; break;
            case 'monthly': increment = 30; break;
            case 'quarterly': increment = 90; break;
            case 'yearly': increment = 365; break;
            default: increment = 0;
        }
        nextDate.setDate(nextDate.getDate() + increment);
        if (now >= nextDate && new Date(template.recurringEndDate) >= nextDate) {
            const usage = await getInvoiceUsageForUser(template.userId);
            if (!usage.canCreate) continue;

            const newInvoice = new Invoice({
                ...template.toObject(),
                _id: undefined,
                isRecurring: false,
                date: nextDate.toISOString().slice(0, 10),
                createdAt: new Date(),
                invoiceNumber: `${template.invoiceNumber}-${nextDate.toISOString().slice(0, 10)}`,
            });
            await newInvoice.save();
        }
    }
}

// Schedule to run every day at 2:00 AM
cron.schedule('0 2 * * *', async () => {
    try {
        await generateRecurringInvoices();
        console.log('Recurring invoice automation ran.');
    } catch (err) {
        console.error('Recurring invoice automation error:', err);
    }
});
