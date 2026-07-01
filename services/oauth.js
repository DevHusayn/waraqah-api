import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import verifyAppleToken from 'verify-apple-id-token';
import User from '../models/User.js';
import BusinessInfo from '../models/CompanyInfo.js';
import { defaultBusinessInfoFields } from '../utils/businessInfoHelpers.js';

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function oauthNotConfigured(provider) {
    const err = new Error(`${provider} sign-in is not configured on the server.`);
    err.status = 503;
    return err;
}

export async function verifyGoogleCredential(credential) {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
        throw oauthNotConfigured('Google');
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
        throw new Error('Google did not return a valid account email.');
    }

    return {
        provider: 'google',
        providerId: payload.sub,
        email: normalizeEmail(payload.email),
        name: payload.name?.trim() || payload.given_name?.trim() || '',
        emailVerified: payload.email_verified !== false,
    };
}

export async function verifyAppleCredential(identityToken) {
    const clientId = process.env.APPLE_CLIENT_ID?.trim();
    if (!clientId) {
        throw oauthNotConfigured('Apple');
    }

    const payload = await verifyAppleToken({
        idToken: identityToken,
        clientId,
    });

    if (!payload?.sub) {
        throw new Error('Apple did not return a valid account.');
    }

    return {
        provider: 'apple',
        providerId: payload.sub,
        email: payload.email ? normalizeEmail(payload.email) : '',
        name: '',
        emailVerified: true,
    };
}

async function randomPasswordHash() {
    return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

export async function findOrCreateOAuthUser(profile) {
    const idField = profile.provider === 'google' ? 'googleId' : 'appleId';
    let user = await User.findOne({ [idField]: profile.providerId });

    if (user) {
        if (user.status === 'suspended') {
            const err = new Error('Account suspended. Contact support.');
            err.status = 403;
            throw err;
        }
        if (profile.emailVerified && user.emailVerified === false) {
            user.emailVerified = true;
            user.emailVerificationToken = undefined;
            user.emailVerificationExpires = undefined;
            await user.save();
        }
        return user;
    }

    if (profile.email) {
        user = await User.findOne({ email: profile.email });
        if (user) {
            if (user.status === 'suspended') {
                const err = new Error('Account suspended. Contact support.');
                err.status = 403;
                throw err;
            }
            user[idField] = profile.providerId;
            if (user.authProvider === 'local') {
                user.authProvider = profile.provider;
            }
            if (profile.emailVerified) {
                user.emailVerified = true;
                user.emailVerificationToken = undefined;
                user.emailVerificationExpires = undefined;
            }
            await user.save();
            return user;
        }
    }

    if (!profile.email) {
        const err = new Error(
            'Apple did not share an email address. Remove this app from Apple ID settings and try again, allowing email sharing.',
        );
        err.status = 400;
        throw err;
    }

    user = await User.create({
        email: profile.email,
        password: await randomPasswordHash(),
        name: profile.name || profile.email.split('@')[0],
        authProvider: profile.provider,
        [idField]: profile.providerId,
        emailVerified: profile.emailVerified,
    });

    await BusinessInfo.create({
        userId: user._id,
        ...defaultBusinessInfoFields,
        email: profile.email,
        name: profile.name || '',
    });

    return user;
}

export function getOAuthConfig() {
    return {
        google: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
        apple: Boolean(process.env.APPLE_CLIENT_ID?.trim()),
    };
}
