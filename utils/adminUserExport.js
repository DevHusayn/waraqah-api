import BusinessInfo from '../models/CompanyInfo.js';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import { getInvoiceUsageMapForUsers } from './invoiceLimits.js';
import { adminDisplayName } from './adminDisplayName.js';
import { isProtectedAdminUser } from './protectedAdmin.js';

export async function enrichAdminUsers(users) {
    if (!users.length) return [];

    const userIds = users.map((u) => u._id);
    const [businessInfos, invoiceCounts, clientCounts, invoiceUsageByUser] = await Promise.all([
        BusinessInfo.find({ userId: { $in: userIds } }),
        Invoice.aggregate([
            { $match: { userId: { $in: userIds } } },
            { $group: { _id: '$userId', count: { $sum: 1 } } },
        ]),
        Client.aggregate([
            { $match: { userId: { $in: userIds } } },
            { $group: { _id: '$userId', count: { $sum: 1 } } },
        ]),
        getInvoiceUsageMapForUsers(userIds),
    ]);

    return users.map((user) => {
        const doc = typeof user.toObject === 'function' ? user.toObject() : user;
        const businessInfo =
            businessInfos.find((bi) => bi.userId.toString() === doc._id.toString()) || null;
        const invoiceCount =
            invoiceCounts.find((ic) => ic._id.toString() === doc._id.toString())?.count || 0;
        const clientCount =
            clientCounts.find((cc) => cc._id.toString() === doc._id.toString())?.count || 0;
        const invoiceUsage = invoiceUsageByUser.get(doc._id.toString());
        return {
            ...doc,
            displayName: adminDisplayName(doc, businessInfo),
            isProtected: isProtectedAdminUser(doc),
            businessInfo,
            invoiceCount,
            clientCount,
            invoiceUsage,
        };
    });
}

function escapeCsvField(value) {
    const str = value == null ? '' : String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/** Excel text formula so numeric/slash values display literally (e.g. phone, 0/5 quota). */
function excelTextCsvField(value) {
    const str = value == null ? '' : String(value);
    if (!str) return '';
    const formula = `="${str.replace(/"/g, '""')}"`;
    return `"${formula.replace(/"/g, '""')}"`;
}

function formatJoinedDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function formatQuota(usage) {
    if (!usage || usage.unlimited) return 'Unlimited';
    return `${usage.used ?? 0}/${usage.limit ?? 5}`;
}

const CSV_HEADERS = [
    'Name',
    'Email',
    'Business name',
    'Phone',
    'Status',
    'Plan',
    'Joined date',
    'Invoices count',
    'Clients count',
    'Quota used this month',
];

export function adminUsersToCsv(users) {
    const rows = users.map((user) => {
        const business = user.businessInfo || {};
        const phone = business.phone || '';
        const quota = formatQuota(user.invoiceUsage);
        return [
            escapeCsvField(user.displayName || user.name || business.name || ''),
            escapeCsvField(user.email || ''),
            escapeCsvField(business.name || ''),
            phone ? excelTextCsvField(phone) : escapeCsvField(''),
            escapeCsvField(user.status || ''),
            escapeCsvField(business.plan || 'free'),
            escapeCsvField(formatJoinedDate(user.createdAt)),
            escapeCsvField(user.invoiceCount ?? 0),
            escapeCsvField(user.clientCount ?? 0),
            quota ? excelTextCsvField(quota) : escapeCsvField(''),
        ];
    });

    return [CSV_HEADERS.map(escapeCsvField).join(','), ...rows.map((row) => row.join(','))].join('\r\n');
}

export const ADMIN_USER_EXPORT_MAX = 10000;
