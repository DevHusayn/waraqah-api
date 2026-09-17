import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isStrongPassword,
    PASSWORD_REQUIREMENTS_MESSAGE,
    SAME_PASSWORD_MESSAGE,
    GOOGLE_SIGN_IN_PASSWORD_MESSAGE,
    canChangePassword,
    changePasswordUnavailableMessage,
    validateChangePasswordPayload,
} from '../utils/passwordValidation.js';

test('validateChangePasswordPayload requires current and new passwords', () => {
    assert.equal(validateChangePasswordPayload({}).status, 400);
    assert.match(validateChangePasswordPayload({ newPassword: 'Password1' }).message, /current password/i);
    assert.match(
        validateChangePasswordPayload({ currentPassword: 'Password1' }).message,
        /new password/i
    );
});

test('validateChangePasswordPayload rejects weak new passwords', () => {
    const result = validateChangePasswordPayload({
        currentPassword: 'Password1',
        newPassword: 'weak',
    });

    assert.equal(result.status, 400);
    assert.equal(result.message, PASSWORD_REQUIREMENTS_MESSAGE);
});

test('validateChangePasswordPayload rejects reusing the current password', () => {
    const result = validateChangePasswordPayload({
        currentPassword: 'Password1',
        newPassword: 'Password1',
    });

    assert.equal(result.status, 400);
    assert.equal(result.message, SAME_PASSWORD_MESSAGE);
});

test('validateChangePasswordPayload accepts a different strong password', () => {
    assert.equal(
        validateChangePasswordPayload({
            currentPassword: 'Password1',
            newPassword: 'Password2',
        }),
        null
    );
    assert.equal(isStrongPassword('Password2'), true);
});

test('canChangePassword is true only for local accounts with a password', () => {
    assert.equal(canChangePassword({ password: 'hash', authProvider: 'local' }), true);
    assert.equal(canChangePassword({ password: 'hash' }), true);
    assert.equal(canChangePassword({ password: 'hash', authProvider: 'google' }), false);
    assert.equal(canChangePassword({ authProvider: 'local' }), false);
    assert.equal(canChangePassword(null), false);
});

test('changePasswordUnavailableMessage explains Google accounts', () => {
    assert.equal(
        changePasswordUnavailableMessage({ authProvider: 'google' }),
        GOOGLE_SIGN_IN_PASSWORD_MESSAGE
    );
    assert.match(changePasswordUnavailableMessage({ authProvider: 'local' }), /not available/i);
});
