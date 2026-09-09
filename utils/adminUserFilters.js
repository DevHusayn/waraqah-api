import BusinessInfo from '../models/CompanyInfo.js';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import Product from '../models/Product.js';
import { escapeRegex } from './pagination.js';

const VALID_PLANS = new Set(['free', 'premium']);
const VALID_STATUSES = new Set(['active', 'suspended', 'admin']);
const VALID_AUTH = new Set(['google', 'email']);

const ACTIVITY_SLUGS = {
    has_workspace: 'with-workspace',
    empty_workspace: 'empty-workspace',
    has_invoices: 'with-invoices',
    no_invoices: 'no-invoices',
    has_receipts: 'with-receipts',
    no_receipts: 'no-receipts',
    has_quotations: 'with-quotations',
    no_quotations: 'no-quotations',
    has_clients: 'with-clients',
    no_clients: 'no-clients',
    has_products: 'with-products',
    no_products: 'no-products',
    active_7d: 'active-7d',
    inactive_30d: 'inactive-30d',
    never_signed_in: 'never-signed-in',
};

const VALID_ACTIVITY = new Set(Object.keys(ACTIVITY_SLUGS));

export function activityFilterSlug(activity) {
    if (!activity || activity === 'all') return null;
    return ACTIVITY_SLUGS[activity] || String(activity).replace(/_/g, '-');
}

export function parseAdminUserFilters(query = {}) {
    const search = String(query.search || '').trim();
    const plan = VALID_PLANS.has(query.plan) ? query.plan : 'all';
    const status = VALID_STATUSES.has(query.status) ? query.status : 'all';
    const activity = VALID_ACTIVITY.has(query.activity) ? query.activity : 'all';
    const auth = VALID_AUTH.has(query.auth) ? query.auth : 'all';
    return { search, plan, status, activity, auth };
}

async function distinctUserIds(Model, query = {}) {
    return (await Model.distinct('userId', query)).filter(Boolean);
}

function mergeIds(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const id of list) {
            const key = String(id);
            if (!seen.has(key)) {
                seen.add(key);
                out.push(id);
            }
        }
    }
    return out;
}

function matchUsersIn(ids) {
    return { _id: { $in: ids.length ? ids : [null] } };
}

function matchUsersNotIn(ids) {
    if (!ids.length) return null;
    return { _id: { $nin: ids } };
}

function daysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function workspaceUserIds() {
    const [invoices, quotations, clients, products] = await Promise.all([
        distinctUserIds(Invoice),
        distinctUserIds(Quotation),
        distinctUserIds(Client),
        distinctUserIds(Product),
    ]);
    return mergeIds(invoices, quotations, clients, products);
}

async function invoiceUserIds() {
    return distinctUserIds(Invoice, {
        $or: [
            { documentType: 'invoice' },
            { documentType: { $exists: false } },
            { documentType: null },
        ],
    });
}

async function receiptUserIds() {
    return distinctUserIds(Invoice, { documentType: 'receipt' });
}

async function buildActivityCondition(activity) {
    switch (activity) {
        case 'has_workspace':
            return matchUsersIn(await workspaceUserIds());
        case 'empty_workspace':
            return matchUsersNotIn(await workspaceUserIds());
        case 'has_invoices':
            return matchUsersIn(await invoiceUserIds());
        case 'no_invoices':
            return matchUsersNotIn(await invoiceUserIds());
        case 'has_receipts':
            return matchUsersIn(await receiptUserIds());
        case 'no_receipts':
            return matchUsersNotIn(await receiptUserIds());
        case 'has_quotations':
            return matchUsersIn(await distinctUserIds(Quotation));
        case 'no_quotations':
            return matchUsersNotIn(await distinctUserIds(Quotation));
        case 'has_clients':
            return matchUsersIn(await distinctUserIds(Client));
        case 'no_clients':
            return matchUsersNotIn(await distinctUserIds(Client));
        case 'has_products':
            return matchUsersIn(await distinctUserIds(Product));
        case 'no_products':
            return matchUsersNotIn(await distinctUserIds(Product));
        case 'active_7d': {
            const since = daysAgo(7);
            return {
                $or: [
                    { lastActiveAt: { $gte: since } },
                    { lastLogin: { $gte: since } },
                ],
            };
        }
        case 'inactive_30d': {
            const cutoff = daysAgo(30);
            return {
                $and: [
                    {
                        $or: [
                            { lastActiveAt: { $exists: false } },
                            { lastActiveAt: null },
                            { lastActiveAt: { $lt: cutoff } },
                        ],
                    },
                    {
                        $or: [
                            { lastLogin: { $exists: false } },
                            { lastLogin: null },
                            { lastLogin: { $lt: cutoff } },
                        ],
                    },
                ],
            };
        }
        case 'never_signed_in':
            return {
                $or: [{ lastLogin: { $exists: false } }, { lastLogin: null }],
            };
        default:
            return null;
    }
}

/** Build a MongoDB filter for admin user list/export (AND logic across filters). */
export async function buildAdminUserFilter({ search, plan, status, activity, auth }) {
    const conditions = [];

    if (status === 'admin') {
        conditions.push({ isAdmin: true });
    } else if (status !== 'all') {
        conditions.push({ status });
    }

    if (auth === 'google') {
        conditions.push({ authProvider: 'google' });
    } else if (auth === 'email') {
        conditions.push({ $nor: [{ authProvider: 'google' }] });
    }

    if (search) {
        const regex = new RegExp(escapeRegex(search), 'i');
        const businessUserIds = await BusinessInfo.find({ name: regex }).distinct('userId');
        const searchOr = [{ email: regex }, { name: regex }];
        if (businessUserIds.length) {
            searchOr.push({ _id: { $in: businessUserIds } });
        }
        conditions.push({ $or: searchOr });
    }

    if (plan === 'premium') {
        const premiumUserIds = await BusinessInfo.find({ plan: 'premium' }).distinct('userId');
        conditions.push({ _id: { $in: premiumUserIds.length ? premiumUserIds : [null] } });
    } else if (plan === 'free') {
        const premiumUserIds = await BusinessInfo.find({ plan: 'premium' }).distinct('userId');
        if (premiumUserIds.length) {
            conditions.push({ _id: { $nin: premiumUserIds } });
        }
    }

    if (activity && activity !== 'all') {
        const activityCondition = await buildActivityCondition(activity);
        if (activityCondition) {
            conditions.push(activityCondition);
        }
    }

    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0];
    return { $and: conditions };
}

/** Short slug for export filenames, e.g. free-active or all. */
export function buildAdminUserFilterSlug({ plan, status, activity, auth, search }) {
    const parts = [];
    if (plan !== 'all') parts.push(plan);
    if (status !== 'all') parts.push(status);
    if (auth !== 'all') parts.push(auth);
    const activitySlug = activityFilterSlug(activity);
    if (activitySlug) parts.push(activitySlug);
    if (search) parts.push('search');
    return parts.length ? parts.join('-') : 'all';
}
