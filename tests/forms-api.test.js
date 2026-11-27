import assert from 'node:assert/strict';
import test from 'node:test';
import { registrationSchema, serviceFormSchema, verificationCodeSchema } from '../src/api/schemas.js';
import { collectionPage } from '../src/api/collection.js';
import { request, resolveApiUrl, ApiError } from '../src/api/http.js';
test('schemas validate step fields and only require fields for the current service', () => {
  assert.equal(registrationSchema.safeParse({ name: 'أحمد', phone: '01111111111', area: '', inviteCode: '' }).success, false);
  assert.equal(verificationCodeSchema.safeParse('12345').success, false);
  assert.equal(serviceFormSchema('custom').safeParse({ address: 'شارع النور', item: 'شاحن' }).success, true);
  assert.equal(serviceFormSchema('shipping').safeParse({ address: 'شارع النور', item: 'شاحن' }).success, false);
});
test('pagination filters before slicing and clamps page after live data changes', () => {
  const orders = Array.from({ length: 25 }, (_, id) => ({ id, type: id % 2 ? 'مشوار' : 'صيدلية' }));
  const result = collectionPage(orders, { page: 3, pageSize: 10, search: 'مشوار' });
  assert.equal(result.total, 12); assert.equal(result.page, 2); assert.equal(result.items.length, 2);
  assert.equal(collectionPage([], { page: 5 }).page, 1);
});
test('API paths cannot escape to another origin or outside the API prefix', () => {
  for (const path of ['https://other.example', '//other.example', '/../private', '/\\other.example']) assert.throws(() => resolveApiUrl(path), ApiError);
});
test('REST cancellation aborts fetch and preserves AbortError', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  const controller = new AbortController(); const pending = request('/session', { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
test('REST errors preserve Retry-After and no-content responses work', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ error: { code: 'PHONE_COOLDOWN', message: 'Wait' } }, { status: 429, headers: { 'Retry-After': '60' } });
  await assert.rejects(request('/whatsapp/send', { method: 'POST', body: { phone: '01111111111' } }), (error) => error.status === 429 && error.retryAfter === 60 && error.message.includes('دقيقة واحدة'));
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await request('/session'), null);
});
