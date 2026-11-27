import { ApiError, request } from './http.js';
import { sendCodeSchema, verifyCodeSchema } from './schemas.js';

export const sendVerificationCode = (payload, { signal } = {}) =>
  request('/whatsapp/send', { method: 'POST', body: sendCodeSchema.parse(payload), signal });

export const verifyVerificationCode = (payload, { signal } = {}) =>
  request('/whatsapp/verify', { method: 'POST', body: verifyCodeSchema.parse(payload), signal });

export async function getSession({ signal } = {}) {
  try {
    return await request('/session', { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const logoutSession = ({ signal } = {}) =>
  request('/session', { method: 'DELETE', signal });
