import express from 'express';
import Client from '../models/Client.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import { sanitizeClientPayload, sanitizeClientUpdates } from '../utils/sanitize.js';
import { sendServerError } from '../utils/apiError.js';

const router = express.Router();

router.get('/', auth, async (req, res) => {
    const clients = await Client.find({ userId: req.user.userId });
    res.json(clients);
});

router.post('/', auth, async (req, res) => {
    try {
        const payload = sanitizeClientPayload(req.body);
        const client = await Client.create({ ...payload, userId: req.user.userId });
        res.status(201).json(client);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        return sendServerError(res, err);
    }
});

router.put('/:id', auth, validateObjectId(), async (req, res) => {
    try {
        const updates = sanitizeClientUpdates(req.body);
        const client = await Client.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            updates,
            { new: true }
        );
        if (!client) return res.status(404).json({ message: 'Client not found' });
        res.json(client);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        return sendServerError(res, err);
    }
});

router.delete('/:id', auth, validateObjectId(), async (req, res) => {
    const client = await Client.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!client) return res.status(404).json({ message: 'Client not found' });
    res.json({ message: 'Client deleted' });
});

export default router;
