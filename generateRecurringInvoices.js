// This script should be run periodically (e.g., via cron or node-schedule) to generate new invoices for active recurring invoice templates.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/waraqah';

async function main() {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

    // Find all active recurring invoices
    const recurringTemplates = await Invoice.find({
        isRecurring: true,
        recurringEndDate: { $ne: null },
    });

    const now = new Date();
    let createdCount = 0;

    for (const template of recurringTemplates) {
        // Check if a new invoice should be generated
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

        // Calculate next occurrence
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
            // Create a new invoice instance (not recurring)
            const newInvoice = new Invoice({
                ...template.toObject(),
                _id: undefined,
                isRecurring: false,
                date: nextDate.toISOString().slice(0, 10),
                createdAt: new Date(),
                invoiceNumber: `${template.invoiceNumber}-${nextDate.toISOString().slice(0, 10)}`,
            });
            await newInvoice.save();
            createdCount++;
        }
    }

    console.log(`Created ${createdCount} recurring invoices.`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
