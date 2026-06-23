import { isProduction } from './envValidation.js';

export function sendServerError(res, err, fallbackMessage = 'Server error') {
    console.error(err);
    if (isProduction()) {
        return res.status(500).json({ message: fallbackMessage });
    }
    return res.status(500).json({ message: fallbackMessage, error: err?.message });
}
