/** Wrap async route handlers so rejected promises reach the global error handler. */
export default function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
