import { isPremiumActive } from './businessInfoHelpers.js';

export const PUSH_AUDIENCES = ['all', 'premium', 'free', 'active', 'inactive', 'individual'];

const ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
const INACTIVE_MS = 30 * 24 * 60 * 60 * 1000;

export function isPushAudience(value) {
    return PUSH_AUDIENCES.includes(value);
}

function lastSeenMs(user) {
    const stamps = [user?.lastActiveAt, user?.lastLogin]
        .map((value) => (value ? new Date(value).getTime() : 0))
        .filter((value) => Number.isFinite(value) && value > 0);
    return stamps.length ? Math.max(...stamps) : 0;
}

/** Same activity windows as the admin user list: active this week, inactive 30+ days. */
export function userMatchesPushAudience(user, business, audience, { userId, now = new Date() } = {}) {
    if (!user || user.status === 'suspended') return false;
    if (audience === 'all') return true;
    if (audience === 'premium') return isPremiumActive(business, now);
    if (audience === 'free') return !isPremiumActive(business, now);
    if (audience === 'active') return lastSeenMs(user) >= now.getTime() - ACTIVE_MS;
    if (audience === 'inactive') {
        const seen = lastSeenMs(user);
        return seen === 0 || seen < now.getTime() - INACTIVE_MS;
    }
    if (audience === 'individual') return Boolean(userId) && String(user._id) === String(userId);
    return false;
}
