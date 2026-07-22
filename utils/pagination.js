const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse page/limit from Express query. Returns { page, limit, skip }.
 */
export function parsePagination(req, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
    const rawPage = Number.parseInt(String(req.query?.page ?? ''), 10);
    const rawLimit = Number.parseInt(String(req.query?.limit ?? ''), 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : DEFAULT_PAGE;
    let limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit;
    if (limit > maxLimit) limit = maxLimit;

    return { page, limit, skip: (page - 1) * limit };
}

export function buildPaginationMeta(page, limit, total) {
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { page, limit, total, totalPages };
}

/**
 * Run a paginated find + countDocuments in parallel.
 * @returns {{ data: any[], total: number }}
 */
export async function paginateFind(Model, filter, { skip, limit, sort, select, lean = true } = {}) {
    let query = Model.find(filter);
    if (sort) query = query.sort(sort);
    if (select) query = query.select(select);
    query = query.skip(skip).limit(limit);
    if (lean) query = query.lean();

    const [data, total] = await Promise.all([query, Model.countDocuments(filter)]);
    return { data, total };
}

/** Escape special regex characters in a user search string. */
export function escapeRegex(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a case-insensitive $or regex filter across fields. */
export function buildSearchFilter(search, fields = []) {
    const q = String(search || '').trim();
    if (!q || fields.length === 0) return null;
    const regex = new RegExp(escapeRegex(q), 'i');
    return { $or: fields.map((field) => ({ [field]: regex })) };
}
