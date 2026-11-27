import { randomUUID } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLocalDevelopmentOtpEnabled(env) {
  if (env.NODE_ENV !== 'development' || env.DEV_OTP_ENABLED !== 'true') return false;
  const apiHost = env.API_HOST || '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(apiHost)) return false;
  try {
    const origin = new URL(env.APP_ORIGIN);
    return origin.protocol === 'http:' && LOOPBACK_HOSTS.has(origin.hostname);
  } catch {
    return false;
  }
}

export function createLocalDevelopmentOtpProvider() {
  return {
    codeLength: 4,
    async send() { return { sid: `local-${randomUUID()}` }; },
    async verify(sid, code) { return sid.startsWith('local-') && code === '5060'; },
  };
}
