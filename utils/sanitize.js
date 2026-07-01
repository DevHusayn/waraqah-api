import mongoose from 'mongoose';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function isValidObjectId(id) {
    return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
}

export function sanitizePlainText(value, maxLen = 500) {
    if (value === undefined || value === null) return '';
    const str = String(value).replace(CONTROL_CHARS, '').trim();
    if (str.length > maxLen) {
        return str.slice(0, maxLen);
    }
    return str;
}

export function sanitizeEmail(value) {
    const normalized = sanitizePlainText(value, 254).toLowerCase();
    if (!normalized) return '';
    if (!EMAIL_PATTERN.test(normalized)) {
        const err = new Error('Please enter a valid email address.');
        err.status = 400;
        throw err;
    }
    return normalized;
}

export function sanitizeOptionalEmail(value) {
    const normalized = sanitizePlainText(value, 254).toLowerCase();
    if (!normalized) return '';
    if (!EMAIL_PATTERN.test(normalized)) {
        const err = new Error('Please enter a valid email address.');
        err.status = 400;
        throw err;
    }
    return normalized;
}

export function sanitizeHexColor(value, fallback = '#16A34A') {
    const color = sanitizePlainText(value, 7);
    if (!color) return fallback;
    if (!HEX_COLOR_PATTERN.test(color)) {
        const err = new Error('Please enter a valid color code (e.g. #16A34A).');
        err.status = 400;
        throw err;
    }
    return color;
}

export function sanitizeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

export function sanitizeDataUrl(value, { maxBytes = 500 * 1024, allowedPrefixes = [] } = {}) {
    if (value === undefined || value === null || value === '') return '';
    const str = String(value);
    if (!allowedPrefixes.some((prefix) => str.startsWith(prefix))) {
        const err = new Error('Invalid image format.');
        err.status = 400;
        throw err;
    }
    const base64Part = str.split(',')[1] || '';
    const approxBytes = Math.ceil((base64Part.length * 3) / 4);
    if (approxBytes > maxBytes) {
        const err = new Error('Image is too large.');
        err.status = 400;
        throw err;
    }
    return str;
}

export function pickFields(source, fields) {
    const result = {};
    for (const field of fields) {
        if (source[field] !== undefined) {
            result[field] = source[field];
        }
    }
    return result;
}

export function sanitizeClientPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid client payload.');
        err.status = 400;
        throw err;
    }

    const name = sanitizePlainText(body.name, 200);
    if (!name) {
        const err = new Error('Client name is required.');
        err.status = 400;
        throw err;
    }

    return {
        name,
        company: sanitizePlainText(body.company, 200),
        email: body.email ? sanitizeOptionalEmail(body.email) : '',
        phone: sanitizePlainText(body.phone, 50),
        address: sanitizePlainText(body.address, 500),
    };
}

export function sanitizeClientUpdates(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid client payload.');
        err.status = 400;
        throw err;
    }

    const updates = {};
    if (body.name !== undefined) {
        const name = sanitizePlainText(body.name, 200);
        if (!name) {
            const err = new Error('Client name is required.');
            err.status = 400;
            throw err;
        }
        updates.name = name;
    }
    if (body.company !== undefined) {
        updates.company = sanitizePlainText(body.company, 200);
    }
    if (body.email !== undefined) {
        updates.email = body.email ? sanitizeOptionalEmail(body.email) : '';
    }
    if (body.phone !== undefined) {
        updates.phone = sanitizePlainText(body.phone, 50);
    }
    if (body.address !== undefined) {
        updates.address = sanitizePlainText(body.address, 500);
    }
    return updates;
}
