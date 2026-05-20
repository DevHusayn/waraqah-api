const STRONG_PASSWORD =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*()_+\-=]{8,}$/;

export const PASSWORD_REQUIREMENTS_MESSAGE =
    'Password must be at least 8 characters and include uppercase, lowercase, and a number.';

export function isStrongPassword(password) {
    return typeof password === 'string' && STRONG_PASSWORD.test(password);
}
