import express from 'express';
import Product from '../models/Product.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.get('/', auth, async (req, res) => {
    const products = await Product.find({ userId: req.user.userId }).sort({ name: 1 });
    res.json(products);
});

router.post('/', auth, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) {
        return res.status(400).json({ message: 'Product name is required' });
    }
    const product = await Product.create({
        userId: req.user.userId,
        name,
        description: String(req.body.description || '').trim(),
        unitPrice: Number(req.body.unitPrice) || 0,
    });
    res.status(201).json(product);
});

router.put('/:id', auth, async (req, res) => {
    const name = req.body.name !== undefined ? String(req.body.name).trim() : undefined;
    if (name !== undefined && !name) {
        return res.status(400).json({ message: 'Product name is required' });
    }
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (req.body.description !== undefined) updates.description = String(req.body.description).trim();
    if (req.body.unitPrice !== undefined) updates.unitPrice = Number(req.body.unitPrice) || 0;

    const product = await Product.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        updates,
        { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
});

router.delete('/:id', auth, async (req, res) => {
    const product = await Product.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
});

export default router;
