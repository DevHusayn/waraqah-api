import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PayrollPaymentEmail from '../templates/PayrollPaymentEmail.js';
import { buildClientEmailBranding, getClientEmailFromAddress } from '../helpers/clientEmailBranding.js';
import {
    buildPayrollPaymentEmailText,
    payrollPaymentEmailSubject,
} from '../../../utils/staffPayroll.js';

export async function sendPayrollPaymentEmail({
    to,
    firstName,
    staffName,
    role,
    businessName,
    periodLabel,
    paymentDateLabel,
    amountLabel,
    replyTo,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);

    return sendEmail({
        to,
        from: getClientEmailFromAddress(brand.businessName),
        replyTo,
        subject: payrollPaymentEmailSubject(periodLabel),
        type: 'payroll-payment',
        react: React.createElement(PayrollPaymentEmail, {
            firstName,
            staffName,
            role,
            businessName: brand.businessName,
            periodLabel,
            paymentDateLabel,
            amountLabel,
            branding: brand,
        }),
        text: buildPayrollPaymentEmailText({
            firstName,
            staffName,
            role,
            businessName: brand.businessName,
            periodLabel,
            paymentDateLabel,
            amountLabel,
        }),
    });
}
