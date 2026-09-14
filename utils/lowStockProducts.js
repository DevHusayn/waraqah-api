import Product from '../models/Product.js';
import { NAME_SORT_COLLATION } from './listSort.js';

function stockAlertProductQuery(filter) {
    return Product.find(filter)
        .select('name quantityOnHand lowStockThreshold')
        .collation(NAME_SORT_COLLATION)
        .sort({ name: 1 })
        .lean();
}

export async function findLowStockProductsForUser(userId) {
    return stockAlertProductQuery({
        userId,
        trackInventory: true,
        quantityOnHand: { $gt: 0 },
        lowStockThreshold: { $ne: null },
        $expr: { $lte: ['$quantityOnHand', '$lowStockThreshold'] },
    });
}

export async function findOutOfStockProductsForUser(userId) {
    return stockAlertProductQuery({
        userId,
        trackInventory: true,
        quantityOnHand: { $lte: 0 },
    });
}
