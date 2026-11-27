import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApiApp } from './app.js';
import { createAuthStore } from './store.js';
import { createWhatsAppVerificationProvider } from './whatsappVerification.js';
import { createLocalDevelopmentOtpProvider, isLocalDevelopmentOtpEnabled } from './devOtp.js';
import { attachApiEvents } from './events.js';
const env = process.env;
const port = Number(env.PORT || env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT or API_PORT must be an integer between 1 and 65535.');
const configured = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_VERIFY_SERVICE_SID].every(Boolean);
const localTestOtp = isLocalDevelopmentOtpEnabled(env);
const provider = localTestOtp
  ? createLocalDevelopmentOtpProvider()
  : configured ? createWhatsAppVerificationProvider({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, serviceSid: env.TWILIO_VERIFY_SERVICE_SID }) : null;
const store = createAuthStore(env.API_STORE_PATH || fileURLToPath(new URL('./.data/auth.sqlite', import.meta.url)));
const app = createApiApp({ env, provider, store });
if (env.NODE_ENV === 'production') app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
const server = createServer(app);
const events = attachApiEvents(server, app.locals.auth);
server.listen(port, env.API_HOST || (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log(`API listening on port ${port}.`);
  if (localTestOtp) console.warn('Local-only test verification is enabled; this mode cannot bind to a non-loopback host.');
  else if (!configured) console.warn('WhatsApp verification is disabled until Twilio Verify credentials are configured.');
});
let closing = false;
function shutdown() {
  if (closing) return; closing = true; events.close();
  server.close(() => { store.close(); process.exitCode = 0; });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
