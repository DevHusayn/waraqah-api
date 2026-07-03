import express from 'express';
import Client from '../models/Client.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import { sanitizeClientPayload, sanitizeClientUpdates } from '../utils/sanitize.js';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();

router.get('/', auth, asyncHandler(async (req, res) => {
    const clients = await Client.find({ userId: req.user.userId }).lean();
    res.json(clients);
}));

router.post('/', auth, asyncHandler(async (req, res) => {
    const payload = sanitizeClientPayload(req.body);
    const client = await Client.create({ ...payload, userId: req.user.userId });
    res.status(201).json(client);
}));

router.put('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const updates = sanitizeClientUpdates(req.body);
    const client = await Client.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        updates,
        { new: true }
    );
    if (!client) return res.status(404).json({ message: 'Client not found' });
    res.json(client);
}));

router.delete('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const client = await Client.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!client) return res.status(404).json({ message: 'Client not found' });
    res.json({ message: 'Client deleted' });
}));

export default router;
