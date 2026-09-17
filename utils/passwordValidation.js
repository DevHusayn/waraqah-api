const STRONG_PASSWORD =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*()_+\-=]{8,}$/;

export const PASSWORD_REQUIREMENTS_MESSAGE =
    'Password must be at least 8 characters and include uppercase, lowercase, and a number.';

export const SAME_PASSWORD_MESSAGE = 'Choose a different password from your current one.';

export const GOOGLE_SIGN_IN_PASSWORD_MESSAGE =
    'This account uses Google sign-in. Password changes are managed through Google.';

export const CURRENT_PASSWORD_INCORRECT_MESSAGE = 'Current password is incorrect.';

export function isStrongPassword(password) {
    return typeof password === 'string' && STRONG_PASSWORD.test(password);
}

export function canChangePassword(user) {
    if (!user?.password) return false;
    return (user.authProvider || 'local') === 'local';
}

export function changePasswordUnavailableMessage(user) {
    if ((user?.authProvider || 'local') === 'google') {
        return GOOGLE_SIGN_IN_PASSWORD_MESSAGE;
    }
    return 'Password changes are not available for this account.';
}

export function validateChangePasswordPayload(body = {}) {
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword) {
        return { status: 400, message: 'Current password is required.' };
    }
    if (!newPassword) {
        return { status: 400, message: 'New password is required.' };
    }
    if (!isStrongPassword(newPassword)) {
        return { status: 400, message: PASSWORD_REQUIREMENTS_MESSAGE };
    }
    if (currentPassword === newPassword) {
        return { status: 400, message: SAME_PASSWORD_MESSAGE };
    }
    return null;
}
