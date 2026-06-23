import { isValidObjectId } from '../utils/sanitize.js';

export default function validateObjectId(paramName = 'id') {
    return (req, res, next) => {
        const id = req.params[paramName];
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: 'Invalid ID format.' });
        }
        next();
    };
}
