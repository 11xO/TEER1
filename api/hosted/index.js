import { createD1AuthStore, AuthStoreError } from './store.js';
import { createWhatsAppVerificationProvider } from '../whatsappVerification.js';
import assets from 'virtual:site-assets';

const SESSION = '__Secure-teer_session';
const BINDING = '__Secure-teer_verification';
const CHALLENGE_TTL = 600000;
const SESSION_TTL = 7 * 86400000;
let nextCleanup = 0;
const fail = (code, status, message) => new AuthStoreError(code, status, message);
const configured = (env) => ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'].every((key) => typeof env[key] === 'string' && env[key].trim());
function verificationProvider(env) {
  if (!configured(env)) throw fail('WHATSAPP_NOT_CONFIGURED', 503, 'خدمة التحقق من واتساب غير مفعّلة بعد.');
  return createWhatsAppVerificationProvider({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, serviceSid: env.TWILIO_VERIFY_SERVICE_SID });
}
const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (part.slice(0, separator).trim() === name) { try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; } }
  }
  return null;
}
const cookie = (name, value, age) => `${name}=${encodeURIComponent(value)}; Max-Age=${age}; Path=/api; HttpOnly; Secure; SameSite=Lax`;
function json(value, status = 200, cookies = [], extra = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(JSON.stringify(value), { status, headers });
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw fail('INVALID_JSON', 415, 'الطلب لازم يكون JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw fail('INVALID_JSON', 400, 'بيانات الطلب غير صالحة.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw fail('PAYLOAD_TOO_LARGE', 413, 'بيانات الطلب كبيرة جداً.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw fail('INVALID_JSON', 400, 'بيانات الطلب غير صالحة.'); }
}
async function sessionFor(request, store) {
  const value = readCookie(request, SESSION);
  return validToken(value) ? store.getSession(await hash(value), Date.now()) : null;
}
async function webSocket(request, store) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: { code: 'UPGRADE_REQUIRED', message: 'WebSocket required.' } }, 426);
  const session = await sessionFor(request, store);
  if (!session) throw fail('UNAUTHENTICATED', 401, 'محتاج تأكيد رقم واتساب.');
  await store.takeRateLimit(`socket:${session.phone}`, 30, 600000, Date.now());
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept(); let closed = false; let lastSeen = Date.now();
  const close = (code = 1000, reason = 'Closed') => { if (closed) return; closed = true; clearInterval(timer); try { server.close(code, reason); } catch { /* Already closed. */ } };
  async function check() {
    const current = await sessionFor(request, store);
    if (!current || current.phone !== session.phone) { server.send(JSON.stringify({ type: 'session.revoked' })); close(1008, 'Session expired'); return false; }
    return true;
  }
  const timer = setInterval(() => {
    if (Date.now() - lastSeen > 60000) { close(1008, 'Heartbeat timeout'); return; }
    check().then((active) => { if (active && !closed) server.send(JSON.stringify({ type: 'heartbeat' })); }).catch(() => close(1011, 'Session check failed'));
  }, 15000);
  server.addEventListener('close', () => close());
  server.addEventListener('error', () => close(1011, 'Socket error'));
  server.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || event.data.length > 2048) { close(1009, 'Invalid message'); return; }
    check().then((active) => { if (active) lastSeen = Date.now(); }).catch(() => close(1011, 'Session check failed'));
  });
  server.send(JSON.stringify({ type: 'session.updated' }));
  return new Response(null, { status: 101, webSocket: client });
}
export async function apiFetch(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (!env.APP_ORIGIN) throw fail('API_NOT_CONFIGURED', 503, 'عنوان التطبيق لم يتم ضبطه في الخادم.');
  const expected = new URL(env.APP_ORIGIN).origin;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || path === '/api/events') {
    if (request.headers.get('Origin') !== expected) throw fail('INVALID_ORIGIN', 403, 'مصدر الطلب غير مسموح.');
  }
  const store = createD1AuthStore(env.DB);
  if (request.method === 'GET' && path === '/api/health') {
    await env.DB.prepare('SELECT token_hash FROM hosted_sessions LIMIT 1').first();
    return json({ status: 'ok', backend: 'worker', storage: 'd1', whatsappConfigured: Boolean(configured(env)) });
  }
  if (Date.now() >= nextCleanup) { nextCleanup = Date.now() + 3600000; ctx.waitUntil(store.cleanup(Date.now()).catch(() => {})); }
  if (request.method === 'GET' && path === '/api/events') return webSocket(request, store);
  if (request.method === 'GET' && path === '/api/session') {
    const session = await sessionFor(request, store);
    if (!session) throw fail('UNAUTHENTICATED', 401, 'محتاج تأكيد رقم واتساب.');
    return json({ verified: true, ...session });
  }
  if (request.method === 'DELETE' && path === '/api/session') {
    const value = readCookie(request, SESSION); if (validToken(value)) await store.revokeSession(await hash(value));
    return json({ verified: false }, 200, [cookie(SESSION, '', 0), cookie(BINDING, '', 0)]);
  }
  if (request.method === 'POST' && path === '/api/whatsapp/send') {
    const payload = await body(request); let phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
    if (phone.startsWith('+20')) phone = '0' + phone.slice(3);
    if (!/^01\d{9}$/.test(phone)) throw fail('INVALID_PHONE', 400, 'اكتب رقم موبايل مصري صحيح.');
    const activeProvider = verificationProvider(env);
    const now = Date.now();
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('oai-authenticated-user-id') || 'unknown';
    await store.takeRateLimit(`send:${ip}`, 10, 3600000, now);
    const resendAt = await store.reserveSend({ phone, now });
    await store.takeRateLimit(`send-phone:${phone}`, 5, 3600000, now);
    let binding = readCookie(request, BINDING); if (!validToken(binding)) binding = token();
    let verification;
    try { verification = await activeProvider.send(`+20${phone.slice(1)}`, { signal: request.signal }); }
    catch { throw fail('WHATSAPP_UNAVAILABLE', 503, 'تعذر إرسال كود واتساب حالياً.'); }
    const challengeId = crypto.randomUUID();
    const challenge = await store.createChallenge({ id: challengeId, phone, providerSid: verification.sid, bindingHash: await hash(binding), now, expiresAt: now + CHALLENGE_TTL });
    return json({ challengeId, phone, expiresAt: challenge.expiresAt, resendAt }, 200, [cookie(BINDING, binding, CHALLENGE_TTL / 1000)]);
  }
  if (request.method === 'POST' && path === '/api/whatsapp/verify') {
    const payload = await body(request); const binding = readCookie(request, BINDING);
    if (!validToken(binding) || typeof payload.challengeId !== 'string' || !/^[a-f0-9-]{36}$/i.test(payload.challengeId)) throw fail('INVALID_CHALLENGE', 400, 'اطلب كود تحقق جديد.');
    if (typeof payload.code !== 'string' || !/^\d{6}$/.test(payload.code)) throw fail('INVALID_CODE', 400, 'اكتب الكود المكوّن من 6 أرقام.');
    const activeProvider = verificationProvider(env);
    const now = Date.now();
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('oai-authenticated-user-id') || 'unknown';
    await store.takeRateLimit(`verify:${ip}`, 30, 600000, now);
    const claim = await store.claimChallenge({ id: payload.challengeId, bindingHash: await hash(binding), now });
    let approved;
    try { approved = await activeProvider.verify(claim.providerSid, payload.code, { signal: request.signal }); }
    catch { await store.rejectChallenge(payload.challengeId, claim.claimToken); throw fail('WHATSAPP_UNAVAILABLE', 503, 'تعذر تأكيد كود واتساب حالياً.'); }
    if (!approved) { await store.rejectChallenge(payload.challengeId, claim.claimToken); throw fail('INVALID_CODE', 400, 'كود التحقق غير صحيح.'); }
    const value = token(); const previous = readCookie(request, SESSION); const issuedAt = Date.now();
    const session = await store.completeChallenge({ id: payload.challengeId, claimToken: claim.claimToken, tokenHash: await hash(value), previousTokenHash: validToken(previous) ? await hash(previous) : null, now: issuedAt, expiresAt: issuedAt + SESSION_TTL });
    return json({ verified: true, ...session }, 200, [cookie(SESSION, value, SESSION_TTL / 1000), cookie(BINDING, '', 0)]);
  }
  throw fail('NOT_FOUND', 404, 'API endpoint not found.');
}
function serveAsset(request) {
  const path = new URL(request.url).pathname;
  const asset = assets[path === '/' ? '/index.html' : path];
  if (!asset || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
  const headers = { 'Content-Type': asset.type, ETag: asset.etag, 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (request.headers.get('If-None-Match') === asset.etag) return new Response(null, { status: 304, headers });
  const bytes = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.content), (char) => char.charCodeAt(0));
  return new Response(bytes, { headers });
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/') && path !== '/api') return serveAsset(request);
    try { return await apiFetch(request, env, ctx); }
    catch (error) {
      const known = error instanceof AuthStoreError;
      return json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'خدمة التحقق غير متاحة مؤقتاً.' } }, known ? error.status : 500, [], error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {});
    }
  },
};
