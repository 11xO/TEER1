import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { AuthStoreError } from './store.js';
import { CHALLENGE_TTL_MS, SESSION_COOKIE_NAME, SESSION_TTL_MS, VERIFICATION_COOKIE_NAME, clearCookie, hashToken, isToken, newToken, readCookie, readSessionFromRequest, writeCookie } from './sessions.js';
const error = (code, status, message) => new AuthStoreError(code, status, message);
const phonePayload = z.object({ phone: z.string().trim().regex(/^(?:01\d{9}|\+201\d{9})$/) }).strict();
const codePayload = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{4,6}$/) }).strict();
export function normalizeEgyptianPhone(value) {
  if (typeof value !== 'string') return null;
  let local = value.trim(); if (local.startsWith('+20')) local = `0${local.slice(3)}`;
  return /^01\d{9}$/.test(local) ? { local, e164: `+20${local.slice(1)}` } : null;
}
function cancellationFor(response) {
  const controller = new AbortController();
  const onClose = () => { if (!response.writableEnded) controller.abort(); };
  response.once('close', onClose);
  return { signal: controller.signal, release() { response.off('close', onClose); } };
}
export function createApiApp({ env = process.env, provider, store, clock = Date.now }) {
  if (!store) throw new Error('An authentication store is required.');
  const production = env.NODE_ENV === 'production';
  if (production && !env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production.');
  const configured = new URL(env.APP_ORIGIN || 'http://localhost:5173');
  if (!['http:', 'https:'].includes(configured.protocol) || production && configured.protocol !== 'https:') throw new Error('APP_ORIGIN must use HTTPS in production.');
  const origin = configured.origin;
  const app = express(); let cleanupAt = 0;
  app.disable('x-powered-by');
  app.locals.auth = { origin, getSession: (request) => readSessionFromRequest(request, store, clock()) };
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store'); response.set('X-Content-Type-Options', 'nosniff');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.get('origin') !== origin) { next(error('INVALID_ORIGIN', 403, 'Request origin is not allowed.')); return; }
    try { const now = clock(); if (now >= cleanupAt) { store.cleanup(now); cleanupAt = now + 60000; } next(); } catch (error) { next(error); }
  });
  app.use('/api', express.json({ limit: '8kb', strict: true }));
  function requireProvider() {
    if (!provider) throw error('WHATSAPP_NOT_CONFIGURED', 503, 'WhatsApp verification has not been configured.');
    return provider;
  }
  app.post('/api/whatsapp/send', async (request, response) => {
    const parsed = phonePayload.safeParse(request.body);
    const phone = parsed.success && normalizeEgyptianPhone(parsed.data.phone);
    if (!phone) throw error('INVALID_PHONE', 400, 'Enter a valid Egyptian mobile number.');
    const activeProvider = requireProvider();
    const now = clock();
    const resendAt = store.reserveSend({ phone: phone.local, ip: request.ip || request.socket.remoteAddress || 'unknown', now });
    let binding = readCookie(request, VERIFICATION_COOKIE_NAME); if (!isToken(binding)) binding = newToken();
    const cancellation = cancellationFor(response);
    let verification;
    try { verification = await activeProvider.send(phone.e164, { signal: cancellation.signal }); }
    catch { throw error('WHATSAPP_UNAVAILABLE', 503, 'WhatsApp verification is temporarily unavailable.'); }
    finally { cancellation.release(); }
    if (!verification || typeof verification.sid !== 'string') throw error('WHATSAPP_UNAVAILABLE', 503, 'WhatsApp verification is temporarily unavailable.');
    const challengeId = randomUUID();
    const challenge = store.createChallenge({ id: challengeId, phone: phone.local, providerSid: verification.sid, bindingHash: hashToken(binding), now, expiresAt: now + CHALLENGE_TTL_MS });
    writeCookie(response, VERIFICATION_COOKIE_NAME, binding, { secure: production, maxAgeMs: CHALLENGE_TTL_MS });
    response.json({ challengeId, phone: phone.local, expiresAt: challenge.expiresAt, resendAt });
  });
  app.post('/api/whatsapp/verify', async (request, response) => {
    const binding = readCookie(request, VERIFICATION_COOKIE_NAME);
    if (!isToken(binding)) throw error('INVALID_CHALLENGE', 400, 'Please request a new verification code.');
    const activeProvider = requireProvider();
    const parsed = codePayload.safeParse(request.body);
    if (!parsed.success) throw error('INVALID_CODE', 400, 'Enter a valid verification code and challenge.');
    const { challengeId, code } = parsed.data;
    if (code.length !== (activeProvider.codeLength || 6)) throw error('INVALID_CODE', 400, `Enter the ${activeProvider.codeLength || 6}-digit verification code.`);
    const now = clock();
    store.takeRateLimit(`verify:${request.ip || request.socket.remoteAddress || 'unknown'}`, 30, 600000, now);
    const challenge = store.claimChallenge({ id: challengeId, bindingHash: hashToken(binding), now });
    const cancellation = cancellationFor(response);
    let approved;
    try { approved = await activeProvider.verify(challenge.providerSid, code, { signal: cancellation.signal }); }
    catch { store.rejectChallenge(challengeId, challenge.claimToken); throw error('WHATSAPP_UNAVAILABLE', 503, 'WhatsApp verification is temporarily unavailable.'); }
    finally { cancellation.release(); }
    if (!approved) { store.rejectChallenge(challengeId, challenge.claimToken); throw error('INVALID_CODE', 400, 'The verification code is incorrect.'); }
    const token = newToken(); const previous = readCookie(request, SESSION_COOKIE_NAME); const issuedAt = clock();
    const session = store.completeChallenge({ id: challengeId, claimToken: challenge.claimToken, tokenHash: hashToken(token), previousTokenHash: isToken(previous) ? hashToken(previous) : null, now: issuedAt, expiresAt: issuedAt + SESSION_TTL_MS });
    writeCookie(response, SESSION_COOKIE_NAME, token, { secure: production, maxAgeMs: SESSION_TTL_MS });
    clearCookie(response, VERIFICATION_COOKIE_NAME, production);
    response.json({ verified: true, ...session });
  });
  app.get('/api/session', (request, response) => {
    const session = readSessionFromRequest(request, store, clock());
    if (!session) throw error('UNAUTHENTICATED', 401, 'Phone verification is required.');
    response.json({ verified: true, ...session });
  });
  app.delete('/api/session', (request, response) => {
    const token = readCookie(request, SESSION_COOKIE_NAME); if (isToken(token)) store.revokeSession(hashToken(token));
    clearCookie(response, SESSION_COOKIE_NAME, production); clearCookie(response, VERIFICATION_COOKIE_NAME, production);
    response.json({ verified: false });
  });
  app.use('/api', (_request, _response, next) => next(error('NOT_FOUND', 404, 'API endpoint not found.')));
  app.use((err, _request, response, next) => {
    if (response.headersSent) { next(err); return; } if (response.destroyed) return;
    const safe = err.type === 'entity.parse.failed' ? error('INVALID_JSON', 400, 'Request body must be valid JSON.') : err.type === 'entity.too.large' ? error('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.') : err instanceof AuthStoreError ? err : error('INTERNAL_ERROR', 500, 'An unexpected error occurred.');
    const payload = { code: safe.code, message: safe.message };
    if (safe.retryAfterSeconds) { payload.retryAfterSeconds = safe.retryAfterSeconds; response.set('Retry-After', String(safe.retryAfterSeconds)); }
    response.status(safe.status).json({ error: payload });
  });
  return app;
}
