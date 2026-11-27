const VERIFY_BASE_URL = 'https://verify.twilio.com/v2';
export function createWhatsAppVerificationProvider({ accountSid, authToken, serviceSid, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!accountSid || !authToken || !serviceSid) throw new Error('Twilio Verify credentials are required.');
  const authorization = `Basic ${btoa(`${accountSid}:${authToken}`)}`;
  async function post(resource, fields, signal) {
    const signals = [AbortSignal.timeout(timeoutMs)]; if (signal) signals.push(signal);
    let response, data;
    try {
      response = await fetchImpl(`${VERIFY_BASE_URL}/Services/${encodeURIComponent(serviceSid)}/${resource}`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), signal: AbortSignal.any(signals) });
      data = await response.json();
    } catch { throw new Error('WhatsApp verification provider unavailable.'); }
    if (!response.ok) throw new Error('WhatsApp verification provider unavailable.');
    return data;
  }
  return {
    codeLength: 6,
    async send(phone, { signal } = {}) {
      const data = await post('Verifications', { To: phone, Channel: 'whatsapp' }, signal);
      if (typeof data.sid !== 'string' || data.status !== 'pending') throw new Error('Unexpected WhatsApp verification response.');
      return { sid: data.sid };
    },
    async verify(verificationSid, code, { signal } = {}) {
      const data = await post('VerificationCheck', { VerificationSid: verificationSid, Code: code }, signal);
      return data.status === 'approved';
    },
  };
}
