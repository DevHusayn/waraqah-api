import { sendServerError } from '../utils/apiError.js';

function buildErrorBody(err) {
    const body = { message: err.message || 'Something went wrong.' };
    if (err.code) body.code = err.code;
    if (err.usage) body.usage = err.usage;
    return body;
}

/** Express error-handling middleware — must be registered after all routes. */
export function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    if (err.status === 400) {
        return res.status(400).json(buildErrorBody(err));
    }

    if (err.code === 'INVOICE_LIMIT_REACHED') {
        return res.status(403).json(buildErrorBody(err));
    }

    if (typeof err.status === 'number' && err.status >= 400 && err.status < 600) {
        return res.status(err.status).json(buildErrorBody(err));
    }

    return sendServerError(res, err);
}

export function notFoundHandler(req, res) {
    res.status(404).json({ message: 'Not found' });
}
