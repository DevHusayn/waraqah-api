import User from '../models/User.js';

/** Block mutating features until the account email is verified. Legacy users without the field pass. */
export default async function requireEmailVerified(req, res, next) {
    try {
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
    } catch (err) {
        console.error('requireEmailVerified error:', err);
        return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
}
