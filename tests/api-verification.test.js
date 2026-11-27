import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApiApp } from '../api/app.js';
import { createAuthStore } from '../api/store.js';
import { attachApiEvents } from '../api/events.js';
import { CHALLENGE_TTL_MS, SESSION_TTL_MS } from '../api/sessions.js';
import { createWhatsAppVerificationProvider } from '../api/whatsappVerification.js';
import { createLocalDevelopmentOtpProvider, isLocalDevelopmentOtpEnabled } from '../api/devOtp.js';
const ORIGIN = 'http://localhost:5173';
const PHONE = '01012345678';
async function fixture(t, options = {}) {
  let time = Date.UTC(2026, 10, 12);
  const sends = [], checks = [];
  const provider = options.provider || {
    send: options.send || (async (phone) => { sends.push(phone); return { sid: `verification-${sends.length}` }; }),
    verify: options.verify || (async (sid, code) => { checks.push({ sid, code }); return code === '123456'; }),
  };
  const store = createAuthStore(':memory:');
  const app = createApiApp({ env: { APP_ORIGIN: ORIGIN, NODE_ENV: 'test' }, provider: options.noProvider ? null : provider, store, clock: () => time });
  const server = createServer(app);
  const events = attachApiEvents(server, app.locals.auth, { intervalMs: 50 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  t.after(async () => { events.close(); await new Promise((done) => server.close(done)); store.close(); });
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  async function request(path, { method = 'GET', body, cookie = cookieHeader(), origin = ORIGIN } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (origin !== null) headers.Origin = origin; if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookies = response.headers.getSetCookie();
    for (const line of cookies) { const [pair] = line.split(';'); const i = pair.indexOf('='); const name = pair.slice(0, i), value = pair.slice(i + 1); if (value) jar.set(name, value); else jar.delete(name); }
    return { status: response.status, body: await response.json(), headers: response.headers, cookies };
  }
  return { request, cookieHeader, sends, checks, base, advance(ms) { time += ms; } };
}
const send = (f, phone = PHONE) => f.request('/api/whatsapp/send', { method: 'POST', body: { phone } });
const verify = (f, challengeId, code = '123456', extra = {}) => f.request('/api/whatsapp/verify', { method: 'POST', body: { challengeId, code }, ...extra });

test('local fixed code works only with a local development configuration', async (t) => {
  const f = await fixture(t, { provider: createLocalDevelopmentOtpProvider() });
  const started = await send(f);
  assert.equal((await verify(f, started.body.challengeId, '1234')).status, 400);
  assert.equal((await verify(f, started.body.challengeId, '5060')).status, 200);
  const local = { NODE_ENV: 'development', DEV_OTP_ENABLED: 'true', API_HOST: '127.0.0.1', APP_ORIGIN: 'http://127.0.0.1:5173' };
  assert.equal(isLocalDevelopmentOtpEnabled(local), true);
  for (const unsafe of [
    { ...local, NODE_ENV: 'production' },
    { ...local, API_HOST: '0.0.0.0' },
    { ...local, APP_ORIGIN: 'https://example.com' },
    { ...local, DEV_OTP_ENABLED: 'false' },
  ]) assert.equal(isLocalDevelopmentOtpEnabled(unsafe), false);
});

test('WhatsApp send normalizes phone, binds browser, never returns a code', async (t) => {
  const f = await fixture(t); const result = await send(f, '+201012345678');
  assert.equal(result.status, 200); assert.deepEqual(f.sends, ['+201012345678']);
  assert.equal(result.body.phone, PHONE); assert.equal(result.body.expiresAt - result.body.resendAt, 540000);
  assert.equal('code' in result.body, false); assert.match(result.cookies[0], /HttpOnly/); assert.match(result.cookies[0], /SameSite=Lax/); assert.match(result.cookies[0], /Path=\/api/);
});
test('invalid numbers, missing provider, and invalid origins fail closed', async (t) => {
  const f = await fixture(t);
  assert.equal((await send(f, '123')).status, 400);
  for (const origin of [null, 'https://other.example']) assert.equal((await f.request('/api/whatsapp/send', { method: 'POST', body: { phone: PHONE }, origin })).status, 403);
  assert.equal(f.sends.length, 0);
  const missing = await fixture(t, { noProvider: true });
  const unavailable = await send(missing);
  assert.equal(unavailable.status, 503); assert.equal(unavailable.body.error.code, 'WHATSAPP_NOT_CONFIGURED');
  const valid = await send(f);
  assert.equal(valid.status, 200); assert.equal(f.sends.length, 1);
});
test('send cooldown prevents duplicate sends before provider call', async (t) => {
  const f = await fixture(t); await send(f); const result = await send(f);
  assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '60'); assert.equal(f.sends.length, 1);
  f.advance(60000); assert.equal((await send(f)).status, 200); assert.equal(f.sends.length, 2);
});
test('verification binds to browser and provider SID, then prevents replay', async (t) => {
  const f = await fixture(t); const started = await send(f);
  assert.equal((await verify(f, started.body.challengeId, '123456', { cookie: '' })).status, 400); assert.equal(f.checks.length, 0);
  const binding = f.cookieHeader(); const approved = await verify(f, started.body.challengeId);
  assert.equal(approved.status, 200); assert.equal(approved.body.verified, true); assert.equal(approved.body.phone, PHONE);
  assert.deepEqual(f.checks, [{ sid: 'verification-1', code: '123456' }]);
  assert.equal((await f.request('/api/session')).status, 200);
  assert.equal((await verify(f, started.body.challengeId, '123456', { cookie: binding })).status, 400); assert.equal(f.checks.length, 1);
});
test('only five attempts are allowed; expired codes do not verify', async (t) => {
  const f = await fixture(t); const started = await send(f);
  for (let i = 0; i < 5; i++) assert.equal((await verify(f, started.body.challengeId, '000000')).status, 400);
  assert.equal((await verify(f, started.body.challengeId)).status, 429); assert.equal(f.checks.length, 5);
  const expired = await fixture(t); const next = await send(expired); expired.advance(CHALLENGE_TTL_MS + 1);
  assert.equal((await verify(expired, next.body.challengeId)).body.error.code, 'CODE_EXPIRED'); assert.equal(expired.checks.length, 0);
});
test('logout revokes copied cookies and server expiry cannot be extended by browser', async (t) => {
  const f = await fixture(t); const started = await send(f); await verify(f, started.body.challengeId);
  const cookie = f.cookieHeader(); await f.request('/api/session', { method: 'DELETE' });
  assert.equal((await f.request('/api/session', { cookie })).status, 401);
  f.advance(60000); const next = await send(f); await verify(f, next.body.challengeId); const newCookie = f.cookieHeader();
  f.advance(SESSION_TTL_MS + 1); assert.equal((await f.request('/api/session', { cookie: newCookie })).status, 401);
});
test('parallel code checks cannot both consume one challenge', async (t) => {
  let release, report;
  const startedCheck = new Promise((done) => { report = done; });
  const result = new Promise((done) => { release = done; });
  let count = 0;
  const f = await fixture(t, { verify: async () => { count++; report(); return result; } });
  const started = await send(f); const first = verify(f, started.body.challengeId); await startedCheck;
  assert.equal((await verify(f, started.body.challengeId)).status, 409); release(true);
  assert.equal((await first).status, 200); assert.equal(count, 1);
});
test('provider failures are reported without exposing provider details', async (t) => {
  const f = await fixture(t, { send: async () => { throw new Error('secret-token'); } });
  const result = await send(f);
  assert.equal(result.status, 503); assert.equal(result.body.error.code, 'WHATSAPP_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result.body), /secret-token/);
});
test('resends cannot reset attempt budget or expiry', async (t) => {
  let count = 0;
  const f = await fixture(t, { send: async () => ({ sid: 'same-sid' }), verify: async () => { count++; return false; } });
  const first = await send(f); for (let i = 0; i < 3; i++) await verify(f, first.body.challengeId, '000000');
  f.advance(60000); const second = await send(f);
  assert.equal(second.body.expiresAt, first.body.expiresAt);
  assert.equal((await verify(f, first.body.challengeId)).status, 400);
  await verify(f, second.body.challengeId, '000000'); await verify(f, second.body.challengeId, '000000');
  assert.equal((await verify(f, second.body.challengeId)).status, 429); assert.equal(count, 5);
});
test('SQLite preserves sessions and revocation across restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'teer-auth-test-'));
  const filename = join(directory, 'auth.sqlite'); let store;
  const target = resolve(directory), intended = resolve(tmpdir());
  assert.ok(target.startsWith(intended + '\\') || target.startsWith(intended + '/'), 'Unexpected test cleanup path');
  try {
    store = createAuthStore(filename); store.createChallenge({ id: 'test', phone: PHONE, providerSid: 'test-sid', bindingHash: 'hash', now: 1000, expiresAt: 100000 });
    const claim = store.claimChallenge({ id: 'test', bindingHash: 'hash', now: 1001 }); store.completeChallenge({ id: 'test', claimToken: claim.claimToken, tokenHash: 'token-hash', now: 1002, expiresAt: 200000 }); store.close();
    store = createAuthStore(filename); assert.equal(store.getSession('token-hash', 1003).phone, PHONE); store.revokeSession('token-hash'); store.close();
    store = createAuthStore(filename); assert.equal(store.getSession('token-hash', 1004), null);
  } finally {
    store?.close();
    rmSync(target, { recursive: true, force: true });
  }
});
test('stale verification handlers cannot finalize or reject a recovered claim', () => {
  const store = createAuthStore(':memory:');
  try {
    store.createChallenge({ id: 'recover', phone: PHONE, providerSid: 'sid', bindingHash: 'binding', now: 0, expiresAt: 600000 });
    const first = store.claimChallenge({ id: 'recover', bindingHash: 'binding', now: 1 });
    const second = store.claimChallenge({ id: 'recover', bindingHash: 'binding', now: 31002 });
    store.rejectChallenge('recover', first.claimToken);
    assert.throws(() => store.completeChallenge({ id: 'recover', claimToken: first.claimToken, tokenHash: 'old', now: 31003, expiresAt: 100000 }), { code: 'INVALID_CHALLENGE' });
    store.completeChallenge({ id: 'recover', claimToken: second.claimToken, tokenHash: 'new', now: 31004, expiresAt: 100000 });
    assert.equal(store.getSession('old', 31005), null); assert.equal(store.getSession('new', 31005).phone, PHONE);
  } finally { store.close(); }
});
test('a code that expires during provider verification cannot create a session', () => {
  const store = createAuthStore(':memory:');
  try {
    store.createChallenge({ id: 'expires', phone: PHONE, providerSid: 'sid', bindingHash: 'binding', now: 0, expiresAt: 1000 });
    const claim = store.claimChallenge({ id: 'expires', bindingHash: 'binding', now: 500 });
    assert.throws(() => store.completeChallenge({ id: 'expires', claimToken: claim.claimToken, tokenHash: 'token', now: 1001, expiresAt: 100000 }), { code: 'CODE_EXPIRED' });
    assert.equal(store.getSession('token', 1002), null);
  } finally { store.close(); }
});
test('Twilio transport uses WhatsApp and the exact bound SID without exposing OTP', async () => {
  const calls = [];
  const provider = createWhatsAppVerificationProvider({ accountSid: 'ACtest', authToken: 'test-token', serviceSid: 'VAtest', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return Response.json(calls.length === 1 ? { sid: 'VEtest', status: 'pending' } : { status: 'approved' });
  } });
  assert.deepEqual(await provider.send('+201012345678'), { sid: 'VEtest' }); assert.equal(await provider.verify('VEtest', '123456'), true);
  assert.equal(calls[0].options.body.get('Channel'), 'whatsapp'); assert.equal(calls[1].options.body.get('VerificationSid'), 'VEtest'); assert.equal(calls[1].options.body.has('To'), false);
});
test('WebSocket requires a cookie and origin, and signals revoked sessions', async (t) => {
  const f = await fixture(t); const started = await send(f); await verify(f, started.body.challengeId);
  const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/api/events', { headers: { Origin: ORIGIN, Cookie: f.cookieHeader() } });
  t.after(() => ws.terminate());
  const messages = []; ws.on('message', (message) => { messages.push(JSON.parse(message)); });
  await once(ws, 'open');
  const closed = once(ws, 'close'); await f.request('/api/session', { method: 'DELETE' }); await closed;
  assert.ok(messages.some((message) => message.type === 'session.revoked'));
  const rejected = new WebSocket(f.base.replace('http:', 'ws:') + '/api/events', { headers: { Origin: 'https://other.example' } });
  const error = once(rejected, 'error'); await error;
});
