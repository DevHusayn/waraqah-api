import crypto from 'crypto';

export function createPasswordResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function hashPasswordResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
