import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPayeeDetail,
    buildPayeeList,
    groupExpensesByPayee,
    vendorMatchKey,
} from '../utils/expensePayees.js';

test('vendorMatchKey treats the same name as one payee', () => {
    assert.equal(vendorMatchKey('  Abdullah Makinde '), vendorMatchKey('abdullah makinde'));
});

test('groupExpensesByPayee merges same-name payments and keeps unnamed separate', () => {
    const { payees, unnamed } = groupExpensesByPayee([
        { _id: '1', vendor: 'Abdullah Makinde', amount: 50000, category: 'transport', date: '2026-09-15' },
        { _id: '2', vendor: 'abdullah makinde', amount: 20000, category: 'rent', date: '2026-09-15' },
        { _id: '3', vendor: 'Abdullah Makinde', amount: 30000, category: 'salaries', date: '2026-09-15' },
        { _id: '4', vendor: '', amount: 8000, category: 'utilities', date: '2026-09-10' },
    ]);

    assert.equal(payees.length, 1);
    assert.equal(payees[0].name, 'Abdullah Makinde');
    assert.equal(payees[0].count, 3);
    assert.equal(payees[0].total, 100000);
    assert.deepEqual(
        payees[0].categories.map((row) => row.category),
        ['transport', 'salaries', 'rent']
    );
    assert.equal(unnamed.length, 1);
    assert.equal(unnamed[0].id, '4');
});

test('buildPayeeList paginates grouped rows', () => {
    const result = buildPayeeList(
        [
            { _id: '1', vendor: 'Ada', amount: 10, date: '2026-09-02', category: 'rent' },
            { _id: '2', vendor: 'Bola', amount: 40, date: '2026-09-03', category: 'transport' },
            { _id: '3', vendor: 'Ada', amount: 5, date: '2026-09-01', category: 'rent' },
        ],
        { sort: 'amountHigh', page: 1, limit: 1 }
    );

    assert.equal(result.total, 2);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].name, 'Bola');
    assert.equal(result.data[0].total, 40);
});

test('buildPayeeDetail totals every payment for one name', () => {
    const detail = buildPayeeDetail('Abdullah Makinde', [
        { vendor: 'Abdullah Makinde', amount: 50000, category: 'transport', date: '2026-09-15' },
        { vendor: 'Abdullah Makinde', amount: 30000, category: 'salaries', date: '2026-09-10' },
    ]);

    assert.equal(detail.name, 'Abdullah Makinde');
    assert.equal(detail.count, 2);
    assert.equal(detail.total, 80000);
    assert.equal(detail.lastDate, '2026-09-15');
});
