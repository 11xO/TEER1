import { useCallback, useEffect, useRef, useState } from 'react';
import { useDatabaseValue } from '../../hooks/useDatabaseValue.js';
import { create, findByPhone, patch, read, saveProfile, write } from '../../api/firebase.js';
import { persistUser, storage, storedUser } from '../../services/storage.js';
import { entries, validPhone } from '../../utils/format.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WHATSAPP_VERIFICATION_ENABLED } from '../../api/http.js';
import { getSession, logoutSession } from '../../api/whatsappVerification.js';
import { useSession } from '../../api/useSession.js';
import { useApiRealtime } from '../../api/realtime.js';
import { clearPrivateSession } from '../../api/queryClient.js';
import { isRememberedVerifiedPhone } from '../../services/storage.js';
import { LOCAL_TEST_OTP_ENABLED } from '../../api/schemas.js';

export function useAuth(toast) {
  const [user, setUser] = useState(storedUser);
  const [pendingId, setPendingId] = useState(() => storage.get('pending_registration_id'));
  const [forcedMessage, setForcedMessage] = useState('');
  const authRevision = useRef(0);
  const client = useQueryClient();
  const verificationSession = useSession();
  useApiRealtime(WHATSAPP_VERIFICATION_ENABLED && verificationSession.data?.verified === true);
  const autoApproval = useDatabaseValue('admin_settings/auto_approval');
  const registration = useDatabaseValue(pendingId ? `pending_registrations/${pendingId}` : null);
  const registrationData = useRef(registration.value);
  registrationData.current = registration.value;
  const registrationStatus = registration.value?.status;
  const customer = useDatabaseValue(user?.phone ? `customers/${user.phone}` : null, null, 'secondary');
  const blacklist = useDatabaseValue(user?.phone ? `blacklist/${user.phone}` : null);

  const logoutNow = useCallback(() => {
    authRevision.current += 1;
    persistUser(null);
    storage.remove('pending_registration_id');
    setUser(null); setPendingId(null);
    if (WHATSAPP_VERIFICATION_ENABLED) logoutSession().then(() => clearPrivateSession(client)).catch(() => clearPrivateSession(client));
    else void clearPrivateSession(client);
  }, [client]);

  useEffect(() => () => { authRevision.current += 1; }, []);
  const login = useCallback(async (data, { revision = authRevision.current, isActive = () => true } = {}) => {
    const isCurrent = () => revision === authRevision.current && isActive();
    if (!isCurrent()) return;
    const phone = String(data.phone).replace(/\D/g, '');
    if (WHATSAPP_VERIFICATION_ENABLED && !(LOCAL_TEST_OTP_ENABLED && isRememberedVerifiedPhone(phone))) {
      const verified = await getSession();
      if (!isCurrent()) return;
      if (!verified?.verified || verified.phone !== phone) throw new Error('محتاج تأكيد رقم واتساب الأول');
    }
    const next = { name: data.name, phone, area: data.area, address: data.address || '' };
    const saved = await read(`approved_users/${phone}`, 'secondary');
    if (!isCurrent()) return;
    if (saved?.address) next.address = saved.address;
    await saveProfile(phone, { ...next, lastLogin: Date.now() });
    if (!isCurrent()) return;
    if (data.inviteCode) {
      const existing = await read(`users_invites/${phone}`);
      const inviter = await read(`invite_codes/${data.inviteCode}`);
      if (!isCurrent()) return;
      if (!existing && inviter && inviter !== phone) await write(`users_invites/${phone}`, { code: data.inviteCode, inviter, usedAt: Date.now(), rewarded: false });
    }
    if (!isCurrent()) return;
    setUser(next); setPendingId(null);
    persistUser(next); storage.remove('pending_registration_id');
    toast('✅ أهلاً بيك!', 'success');
  }, [toast]);

  useEffect(() => {
    if (!pendingId || !registrationStatus) return undefined;
    if (registrationStatus === 'approved') {
      let active = true;
      const revision = authRevision.current;
      const timer = setTimeout(() => {
        if (registrationData.current?.status !== 'approved') return;
        login(registrationData.current, { revision, isActive: () => active }).catch(() => {
          if (active && revision === authRevision.current) toast('تعذر تسجيل الدخول، تأكد من الاتصال وحاول تاني', 'error');
        });
      }, 2000);
      return () => { active = false; clearTimeout(timer); };
    }
    return undefined;
  }, [pendingId, registrationStatus, verificationSession.data?.phone, verificationSession.data?.verified, login, toast]);

  useEffect(() => {
    const data = customer.value;
    if (!data || !user) return;
    if (data.forceLogout === true && Number(data.forceLogoutAt) > Number(storage.get('last_force_logout', 0))) {
      storage.set('last_force_logout', data.forceLogoutAt);
      setForcedMessage(data.forceLogoutMessage || 'تم إنهاء الجلسة من الإدارة');
      logoutNow();
      return;
    }
    const changes = { name: data.name || user.name, area: data.area || user.area, address: data.address ?? user.address };
    if (Object.entries(changes).some(([key, value]) => user[key] !== value)) {
      const next = { ...user, ...changes };
      setUser(next); persistUser(next);
    }
  }, [customer.value, logoutNow, user]);

  useEffect(() => {
    if (blacklist.value !== null && blacklist.value !== undefined) {
      logoutNow(); toast('🚫 الرقم ده محظور', 'error');
    }
  }, [blacklist.value, logoutNow, toast]);

  useEffect(() => {
    if (!user?.phone) return;
    const now = Date.now();
    patch('/', { [`customers/${user.phone}/lastLogin`]: now, [`approved_users/${user.phone}/lastLogin`]: now }, 'secondary').catch(() => {});
  }, [user?.phone]);

  async function register(data) {
    if (!data.name.trim()) throw new Error('اكتب اسمك');
    if (!validPhone(data.phone)) throw new Error('رقم الموبايل لازم 11 رقم');
    if (!data.area) throw new Error('اختر منطقتك');
    if (WHATSAPP_VERIFICATION_ENABLED && !(LOCAL_TEST_OTP_ENABLED && isRememberedVerifiedPhone(data.phone))) {
      const verified = await getSession();
      if (!verified?.verified || verified.phone !== data.phone) throw new Error('محتاج تأكيد رقم واتساب الأول');
    }
    if (await read(`blacklist/${data.phone}`) !== null) throw new Error('🚫 الرقم ده محظور');
    if (WHATSAPP_VERIFICATION_ENABLED) {
      await login({ ...data, name: data.name.trim(), address: '', inviteCode: data.inviteCode.trim().toUpperCase() });
      return null;
    }
    const existing = entries(await findByPhone('pending_registrations', data.phone))
      .filter((item) => ['approved', 'pending'].includes(item.status)).sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    const approved = existing.find((item) => item.status === 'approved');
    if (approved) { await login(approved); return null; }
    const pending = existing.find((item) => item.status === 'pending');
    if (pending) { storage.set('pending_registration_id', pending.id); setPendingId(pending.id); return pending; }
    const request = { ...data, name: data.name.trim(), address: '', inviteCode: data.inviteCode.trim().toUpperCase(), status: 'pending', requestedAt: Date.now(), whatsappSent: !WHATSAPP_VERIFICATION_ENABLED, deviceInfo: navigator.userAgent.substring(0, 100) };
    const id = await create('pending_registrations', request);
    storage.set('pending_registration_id', id); setPendingId(id);
    return { ...request, id };
  }

  async function cancelRegistration() {
    authRevision.current += 1;
    if (pendingId) await patch(`pending_registrations/${pendingId}`, { status: 'cancelled' });
    storage.remove('pending_registration_id'); setPendingId(null);
  }
  async function updateProfile(changes) {
    if (!user?.phone) throw new Error('لازم تتقبل الأول');
    await saveProfile(user.phone, changes);
    const savedPhone = user.phone;
    setUser((current) => { if (!current || current.phone !== savedPhone) return current; const next = { ...current, ...changes }; persistUser(next); return next; });
  }
  const registrationMutation = useMutation({ mutationKey: ['registration'], mutationFn: register, retry: false });
  return {
    user,
    pendingId, pending: registration.value, pendingLoading: registration.loading, pendingError: registration.error,
    manualApproval: autoApproval.value ? autoApproval.value.enabled !== true : false,
    waitingMinutes: Number(autoApproval.value?.minutes) || 5,
    suspended: customer.value?.isSuspended === true,
    sessionLoading: Boolean(user?.phone) && (customer.loading || blacklist.loading),
    sessionError: customer.error || blacklist.error,
    forcedMessage, dismissForcedMessage: () => setForcedMessage(''),
    verificationSession,
    verificationRequired: WHATSAPP_VERIFICATION_ENABLED && Boolean(user?.phone) && (!verificationSession.data?.verified || verificationSession.data.phone !== user.phone),
    register: registrationMutation.mutateAsync, registrationSubmitting: registrationMutation.isPending, cancelRegistration, updateProfile, logoutNow,
    backToRegistration: () => { authRevision.current += 1; storage.remove('pending_registration_id'); setPendingId(null); },
  };
}
