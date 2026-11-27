export const WHATSAPP_VERIFICATION_ENABLED = import.meta.env?.VITE_WHATSAPP_VERIFICATION_ENABLED !== 'false';
export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const messages = {
  WHATSAPP_NOT_CONFIGURED: 'خدمة أكواد واتساب لسه غير مفعّلة. تواصل مع الدعم.',
  WHATSAPP_UNAVAILABLE: 'تعذر إرسال أو تأكيد الكود حالياً. حاول مرة أخرى.',
  INVALID_PHONE: 'اكتب رقم موبايل مصري صحيح.', INVALID_CODE: 'كود التحقق غير صحيح.',
  INVALID_CHALLENGE: 'اطلب كود تحقق جديد.', CODE_EXPIRED: 'انتهت صلاحية الكود. اطلب كود جديد.',
  PHONE_COOLDOWN: 'استنى شوية قبل طلب كود جديد.', TOO_MANY_REQUESTS: 'طلبات كتير. حاول بعد شوية.',
  TOO_MANY_ATTEMPTS: 'وصلت للحد الأقصى للمحاولات. اطلب كود جديد بعد انتهاء المدة.',
  VERIFICATION_IN_PROGRESS: 'جاري التحقق من الكود بالفعل.', UNAUTHENTICATED: 'محتاج تأكيد رقم واتساب.',
};
function retryDuration(seconds) {
  const total = Math.max(1, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  const minuteText = minutes === 1 ? 'دقيقة واحدة' : minutes === 2 ? 'دقيقتين' : `${minutes} دقائق`;
  if (minutes && remainingSeconds) return `${minuteText} و${remainingSeconds} ثانية`;
  if (minutes) return minuteText;
  return `${remainingSeconds} ثانية`;
}
export class ApiError extends Error {
  constructor(status, code, message, fieldErrors = {}, retryAfter = null) {
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryDuration(retryAfter) : null;
    const retryMessage = code === 'PHONE_COOLDOWN' && wait ? `استنى ${wait} قبل طلب كود جديد.` : code === 'TOO_MANY_REQUESTS' && wait ? `وصلت للحد المؤقت للطلبات. تقدر تحاول بعد ${wait}.` : null;
    super(retryMessage || messages[code] || message); this.name = 'ApiError'; this.status = status;
    this.code = code; this.fieldErrors = fieldErrors; this.retryAfter = retryAfter;
  }
}
export function resolveApiUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32)) throw new ApiError(0, 'INVALID_API_URL', 'مسار الخدمة غير صالح.');
  const origin = globalThis.location?.origin || 'http://localhost';
  const base = new URL(API_BASE_URL || '/', origin);
  if (base.origin !== origin || base.username || base.password || base.search || base.hash) throw new ApiError(0, 'INVALID_API_URL', 'عنوان الخدمة يجب أن يكون على نفس الموقع.');
  const prefix = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${prefix}${path}`, origin);
  if (url.origin !== origin || !url.pathname.startsWith(`${prefix}/`)) throw new ApiError(0, 'INVALID_API_URL', 'مسار الخدمة غير صالح.');
  return url;
}
function composeSignal(signal, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('Invalid request timeout');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs) : null;
  return { signal: controller.signal, cleanup() { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
export async function request(path, { method = 'GET', body, signal, headers, timeoutMs = 20000 } = {}) {
  const url = resolveApiUrl(path);
  const requestHeaders = new Headers(headers); requestHeaders.set('Accept', 'application/json');
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  const composed = composeSignal(signal, timeoutMs);
  try {
    const response = await fetch(url, { method, credentials: 'include', headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: composed.signal });
    const raw = response.status === 204 ? '' : await response.text();
    let data = null;
    if (raw) { try { data = JSON.parse(raw); } catch { if (response.ok) throw new ApiError(response.status, 'INVALID_RESPONSE', 'وصل رد غير صالح من الخادم.'); } }
    if (!response.ok) {
      const error = data?.error;
      const retry = response.headers.get('Retry-After');
      const retryAfter = retry === null ? null : Number.isFinite(Number(retry)) ? Math.max(0, Number(retry)) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000));
      throw new ApiError(response.status, error?.code || 'HTTP_ERROR', error?.message || 'تعذر إتمام الطلب.', error?.fields || {}, retryAfter);
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw signal.reason || new DOMException('Request cancelled', 'AbortError');
    if (composed.signal.aborted) throw new ApiError(0, 'REQUEST_TIMEOUT', 'انتهت مهلة الاتصال. حاول مرة أخرى.');
    if (error instanceof ApiError) throw error;
    if (error instanceof TypeError) throw new ApiError(0, 'NETWORK_ERROR', 'تعذر الاتصال بالخادم. تحقق من الإنترنت.');
    throw error;
  } finally { composed.cleanup(); }
}
