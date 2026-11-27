import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { createD1AuthStore } from '../../api/hosted/store.js';

const ORIGIN = 'https://teer.test';

async function fixture(t, { withProvider = false } = {}) {
  const calls = [];
  const runtime = new Miniflare({ modules: true, scriptPath: resolve('dist/server/index.js'), compatibilityDate: '2025-04-01', d1Databases: { DB: 'hosted-auth-test' },
    bindings: { APP_ORIGIN: ORIGIN, ...(withProvider ? { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_VERIFY_SERVICE_SID: 'VAtest' } : {}) },
    outboundService: async (request) => {
      assert.equal(new URL(request.url).hostname, 'verify.twilio.com');
      const fields = new URLSearchParams(await request.text()); calls.push({ url: request.url, fields });
      return Response.json(request.url.endsWith('/Verifications') ? { sid: 'VEtest', status: 'pending' } : { status: fields.get('Code') === '123456' ? 'approved' : 'pending' });
    },
  });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  for (const filename of readdirSync('drizzle').filter((name) => name.endsWith('.sql'))) {
    for (const sql of readFileSync(`drizzle/${filename}`, 'utf8').split('--> statement-breakpoint').filter((query) => query.trim())) await db.prepare(sql).run();
  }
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  async function request(path, { method = 'GET', body, origin = ORIGIN, cookie = cookieHeader() } = {}) {
    const headers = { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) };
    const response = await runtime.dispatchFetch(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const pair = value.split(';')[0]; const index = pair.indexOf('='); const name = pair.slice(0, index), content = pair.slice(index + 1); if (content) jar.set(name, content); else jar.delete(name); }
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  return { runtime, db, request, cookieHeader, calls };
}
test('hosted Worker serves frontend assets and a live D1 health endpoint', async (t) => {
  const f = await fixture(t);
  const home = await f.runtime.dispatchFetch(ORIGIN + '/'); assert.equal(home.status, 200); assert.match(await home.text(), /id="root"/);
  const health = await f.request('/api/health');   assert.equal(health.status, 200); assert.equal(health.data.storage, 'd1'); assert.equal(health.data.whatsappConfigured, false);
  assert.equal((await f.request('/api/session')).status, 401);
  assert.equal((await f.request('/api/no-route')).status, 404);
  const send = await f.request('/api/whatsapp/send', { method: 'POST', body: { phone: '01111111111' } });
  assert.equal(send.status, 503); assert.equal(send.data.error.code, 'WHATSAPP_NOT_CONFIGURED'); assert.equal(f.calls.length, 0);
});
test('hosted OTP verifies with provider, binds browser and revokes the session', async (t) => {
  const f = await fixture(t, { withProvider: true });
  const started = await f.request('/api/whatsapp/send', { method: 'POST', body: { phone: '01111111111' } });
  assert.equal(started.status, 200); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].fields.get('Channel'), 'whatsapp');
  const binding = f.cookieHeader();
  assert.equal((await f.request('/api/whatsapp/verify', { method: 'POST', body: { challengeId: started.data.challengeId, code: '123456' }, cookie: '' })).status, 400);
  const wrong = await f.request('/api/whatsapp/verify', { method: 'POST', body: { challengeId: started.data.challengeId, code: '000000' } }); assert.equal(wrong.status, 400);
  const verified = await f.request('/api/whatsapp/verify', { method: 'POST', body: { challengeId: started.data.challengeId, code: '123456' } });
  assert.equal(verified.status, 200); assert.equal(verified.data.verified, true); assert.match(verified.headers.get('Set-Cookie'), /HttpOnly/); assert.match(verified.headers.get('Set-Cookie'), /Secure/);
  assert.equal((await f.request('/api/session')).data.phone, '01111111111');
  const copied = f.cookieHeader();
  assert.equal((await f.request('/api/whatsapp/verify', { method: 'POST', body: { challengeId: started.data.challengeId, code: '123456' }, cookie: binding })).status, 400);
  await f.request('/api/session', { method: 'DELETE' });
  assert.equal((await f.request('/api/session', { cookie: copied })).status, 401);
});
test('hosted endpoints reject other origins before contacting WhatsApp', async (t) => {
  const f = await fixture(t, { withProvider: true });
  const result = await f.request('/api/whatsapp/send', { method: 'POST', body: { phone: '01111111111' }, origin: 'https://other.test' });
  assert.equal(result.status, 403); assert.equal(f.calls.length, 0);
});
test('D1 claims, sends and finalization remain atomic under concurrent requests', async (t) => {
  const f = await fixture(t); const store = createD1AuthStore(f.db); const now = Date.now();
  const sends = await Promise.allSettled([store.reserveSend({ phone: '01111111111', now }), store.reserveSend({ phone: '01111111111', now })]);
  assert.equal(sends.filter((result) => result.status === 'fulfilled').length, 1);
  await store.createChallenge({ id: 'atomic', phone: '01111111111', providerSid: 'sid', bindingHash: 'binding', now, expiresAt: now + 600000 });
  const claims = await Promise.allSettled([store.claimChallenge({ id: 'atomic', bindingHash: 'binding', now }), store.claimChallenge({ id: 'atomic', bindingHash: 'binding', now })]);
  assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
  const claim = claims.find((result) => result.status === 'fulfilled').value;
  const commits = await Promise.allSettled([
    store.completeChallenge({ id: 'atomic', claimToken: claim.claimToken, tokenHash: 'first', now: now + 1, expiresAt: now + 100000 }),
    store.completeChallenge({ id: 'atomic', claimToken: claim.claimToken, tokenHash: 'second', now: now + 1, expiresAt: now + 100000 }),
  ]);
  assert.equal(commits.filter((result) => result.status === 'fulfilled').length, 1);
  const sessions = await f.db.prepare('SELECT COUNT(*) AS count FROM hosted_sessions').first(); assert.equal(sessions.count, 1);
});
