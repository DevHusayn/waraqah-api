import express from 'express';
import auth from '../middleware/auth.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getMergedDraftsForUser } from '../utils/documentDrafts.js';
import { parsePagination, buildPaginationMeta } from '../utils/pagination.js';

const router = express.Router();

/** Combined invoice + quotation drafts (paginated). */
router.get('/', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { page, limit, skip } = parsePagination(req);
    const search = String(req.query.search || '').trim();

    const { data, total } = await getMergedDraftsForUser(userId, { skip, limit, search });

    res.json({
        data,
        pagination: buildPaginationMeta(page, limit, total),
    });
}));

export default router;
