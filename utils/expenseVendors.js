/** Deduplicate payee names case-insensitively, keeping first spelling. */
export function uniqueVendorNames(names) {
    const seen = new Set();
    const result = [];

    for (const raw of names || []) {
        const name = String(raw || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(name);
    }

    return result.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
