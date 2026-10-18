import BusinessInfo from '../../../models/CompanyInfo.js';
import { sendPayrollPaymentEmail } from '../senders/payrollPaymentEmail.js';
import { buildClientEmailBranding, resolveClientReplyTo } from './clientEmailBranding.js';
import { logEmailFailure } from '../errors.js';
import { normalizeCurrency } from '../../../utils/locale.js';
import {
    formatPayrollAmount,
    formatPayrollPaymentDate,
    formatPayrollPeriodLabel,
    staffFirstName,
} from '../../../utils/staffPayroll.js';

export async function trySendPayrollPaymentEmail({ staff, expense, year, month, userId }) {
    const to = String(staff?.email || '').trim().toLowerCase();
    if (!to) {
        return { emailSent: false, emailSkipped: 'no_email' };
    }

    try {
        const businessInfo = await BusinessInfo.findOne({ userId }).lean();
        const businessName = businessInfo?.name?.trim() || 'Your business';
        const currency = normalizeCurrency(businessInfo?.defaultCurrency);
        const branding = buildClientEmailBranding(businessInfo, businessName);
        const periodLabel = formatPayrollPeriodLabel(year, month);
        const staffName = String(staff.name || '').trim();
        const role = String(staff.role || '').trim() || '—';

        await sendPayrollPaymentEmail({
            to,
            firstName: staffFirstName(staffName),
            staffName,
            role,
            businessName,
            periodLabel,
            paymentDateLabel: formatPayrollPaymentDate(expense.date),
            amountLabel: formatPayrollAmount(expense.amount, currency),
            replyTo: resolveClientReplyTo(businessInfo),
            branding,
        });

        return { emailSent: true, sentTo: to };
    } catch (err) {
        logEmailFailure({ type: 'payroll-payment', to, err });
        return { emailSent: false, emailSkipped: 'send_failed' };
    }
}
