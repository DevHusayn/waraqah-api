export function adminDisplayName(user, businessInfo) {
    const account = String(user?.name || '').trim();
    if (account) return account;
    return String(businessInfo?.name || '').trim();
}
