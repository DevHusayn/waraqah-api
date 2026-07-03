import User from '../models/User.js';
import asyncHandler from './asyncHandler.js';

/** Block mutating features until the account email is verified. Legacy users without the field pass. */
export default asyncHandler(async function requireEmailVerified(req, res, next) {
    const user = await User.findById(req.user.userId).select('emailVerified status');
    if (!user) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    if (user.emailVerified === false) {
        return res.status(403).json({
            message: 'Please verify your email before using this feature. Check your inbox or resend the verification link from Settings.',
            code: 'EMAIL_NOT_VERIFIED',
        });
    }
    return next();
});
