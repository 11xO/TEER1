export const storage = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* Private browsing or full storage. */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* Storage is optional. */ }
  },
  json(key, fallback) {
    try { return JSON.parse(storage.get(key)) ?? fallback; } catch { return fallback; }
  },
};
export function storedUser() {
  const name = storage.get('user_name');
  const phone = storage.get('user_phone');
  const area = storage.get('user_area');
  return name && phone && area ? { name, phone, area, address: storage.get('user_address', '') } : null;
}
export function persistUser(user) {
  for (const key of ['name', 'phone', 'area', 'address']) {
    if (user) storage.set(`user_${key}`, user[key] || '');
    else storage.remove(`user_${key}`);
  }
}

export function rememberedVerifiedPhones() {
  const value = storage.json('teer_verified_phones', []);
  return Array.isArray(value) ? value.map((phone) => String(phone).replace(/\D/g, '')).filter(Boolean) : [];
}
export function isRememberedVerifiedPhone(phone) {
  const normalized = String(phone).replace(/\D/g, '');
  return Boolean(normalized) && rememberedVerifiedPhones().includes(normalized);
}
export function rememberVerifiedPhone(phone) {
  const normalized = String(phone).replace(/\D/g, '');
  if (!normalized) return;
  const phones = rememberedVerifiedPhones();
  if (!phones.includes(normalized)) storage.set('teer_verified_phones', JSON.stringify([...phones, normalized]));
}

export function saveLastLoginProfile(profile) {
  if (!profile?.phone) return;
  storage.set('teer_last_login_profile', JSON.stringify({
    name: String(profile.name || ''),
    phone: String(profile.phone || ''),
    area: String(profile.area || ''),
  }));
}
export function lastLoginProfile() {
  const value = storage.json('teer_last_login_profile', null);
  return value && typeof value === 'object' ? value : null;
}
