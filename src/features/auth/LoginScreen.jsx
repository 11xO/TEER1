import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useApp } from '../../context/AppContext.jsx';
import { useDatabaseValue } from '../../hooks/useDatabaseValue.js';
import AreaPicker from '../../components/AreaPicker.jsx';
import { Icon } from '../../components/ui.jsx';
import { enabled, whatsappUrl } from '../../utils/format.js';
import { ApiForm, FieldError } from '../../api/forms.jsx';
import { registrationSchema } from '../../api/schemas.js';
import { WHATSAPP_VERIFICATION_ENABLED } from '../../api/http.js';
import { useVerification } from '../../api/useVerification.js';
import VerificationCodeForm from './VerificationCodeForm.jsx';
import { isRememberedVerifiedPhone, lastLoginProfile, rememberVerifiedPhone, saveLastLoginProfile } from '../../services/storage.js';
import { LOCAL_TEST_OTP_ENABLED } from '../../api/schemas.js';

export function registrationMessage(data) {
  return `🔔 *طلب تسجيل جديد في Teer*\n━━━━━━━━━━━━━━━━━━\n👤 *الاسم:* ${data.name}\n📱 *الرقم:* ${data.phone}\n📍 *المنطقة:* ${data.area}\n${data.inviteCode ? `🎁 *كود الدعوة:* ${data.inviteCode}\n` : ''}⏰ *الوقت:* ${new Date(data.requestedAt).toLocaleString('ar-EG')}\n━━━━━━━━━━━━━━━━━━\n✅ برجاء الموافقة على الطلب 🙏`;
}
export default function LoginScreen() {
  const { register: registerAccount, registrationSubmitting, support, toast, online } = useApp();
  const lastProfile = lastLoginProfile();
  const form = useForm({ resolver: zodResolver(registrationSchema), defaultValues: { name: lastProfile?.name || '', phone: lastProfile?.phone || '', area: lastProfile?.area || '', inviteCode: '' } });
  const area = useWatch({ control: form.control, name: 'area' });
  const settings = useDatabaseValue(area ? `reward_settings/${area}` : null);
  const verification = useVerification();
  const [picker, setPicker] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const loading = registrationSubmitting || verification.sendMutation.isPending || verification.verifyMutation.isPending;
  function openWhatsAppVerification(popup) {
    if (popup) popup.location.replace(whatsappUrl(support, 'طلب كود التحقق من TEER'));
  }
  async function completeRegistration(data, popup) {
    try {
      const pending = await registerAccount(data);
      if (pending && popup) popup.location.replace(whatsappUrl(support, registrationMessage(pending)));
      else popup?.close();
      if (pending && !popup && !WHATSAPP_VERIFICATION_ENABLED) toast('طلبك اتسجل، اضغط «افتح الواتساب تاني» لإرسال الرسالة', 'info');
    } catch (error) { popup?.close(); throw error; }
  }
  async function submit(data) {
    if (loading) return;
    if (!online) { toast('اتصل بالإنترنت للتسجيل', 'error'); return; }
    setError(null);
    const payload = { ...data, inviteCode: enabled(settings.value?.inviteActive) ? data.inviteCode : '' };
    if (WHATSAPP_VERIFICATION_ENABLED) {
      if (LOCAL_TEST_OTP_ENABLED && isRememberedVerifiedPhone(payload.phone)) {
        saveLastLoginProfile(payload);
        await completeRegistration(payload, null);
        return;
      }
      const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
      try {
        const nextChallenge = await verification.sendMutation.mutateAsync({ phone: data.phone });
        openWhatsAppVerification(popup);
        setChallenge(nextChallenge); setProfile(payload);
      } catch (error) {
        popup?.close();
        if (error.name !== 'AbortError') setError(error.message);
      }
      return;
    }
    const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
    try { await completeRegistration(payload, popup); } catch (error) { setError(error.message); }
  }
  async function resend() {
    setError(null);
    const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
    try {
      const nextChallenge = await verification.sendMutation.mutateAsync({ phone: profile.phone });
      openWhatsAppVerification(popup);
      setChallenge(nextChallenge);
    } catch (error) {
      popup?.close();
      if (error.name !== 'AbortError') setError(error.message);
    }
  }
  const errors = form.formState.errors;
  return <>
    <div className="login-screen" id="loginSection"><div className="login-bg-decor"><div className="login-bg-orb orb-1" /><div className="login-bg-orb orb-2" /></div><div className="login-card">
      <div className="login-logo-wrap"><div className="login-logo-bg" /><img src="./logo.webp" alt="Teer" className="login-logo" /></div><div className="login-title">{challenge ? 'كود التحقق' : 'أهلاً بيك 👋'}</div>
      {challenge ? <VerificationCodeForm key={challenge.challengeId} challenge={challenge} verification={verification} onVerified={() => { rememberVerifiedPhone(profile.phone); saveLastLoginProfile(profile); completeRegistration(profile); }} onResend={resend} onBack={() => { verification.reset(); setChallenge(null); setProfile(null); setError(null); }} submitting={registrationSubmitting} error={error} /> : <ApiForm form={form} onSubmit={submit}>
        <div className="login-sub">سجل بياناتك وابدأ في 30 ثانية</div>
        <div className="inp-wrap"><input {...form.register('name')} type="text" id="uNameInput" placeholder="اسمك الكامل" aria-label="اسمك الكامل" autoComplete="name" aria-invalid={Boolean(errors.name)} /><Icon name="fa-user" /></div><FieldError error={errors.name} />
        <div className="inp-wrap"><input {...form.register('phone')} type="tel" id="uPhoneInput" placeholder="رقم موبايلك (11 رقم)" aria-label="رقم موبايلك" autoComplete="tel" inputMode="tel" maxLength={11} aria-invalid={Boolean(errors.phone)} /><Icon name="fa-mobile-alt" /></div><FieldError error={errors.phone} />
        <div className="inp-wrap"><button type="button" className={`area-trigger-btn ${area ? 'filled' : ''}`} onClick={() => setPicker(true)} aria-invalid={Boolean(errors.area)}><span>{area ? `📍 ${area}` : '📍 اختر منطقتك...'}</span></button><Icon name="fa-map-marker-alt" style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 15, pointerEvents: 'none' }} /></div><FieldError error={errors.area} />
        {enabled(settings.value?.inviteActive) && <div className="inp-wrap"><input {...form.register('inviteCode')} type="text" placeholder="🎁 كود دعوة صاحبك (اختياري)" aria-label="كود دعوة صاحبك (اختياري)" style={{ textTransform: 'uppercase' }} /><Icon name="fa-gift" /></div>}<FieldError error={errors.inviteCode || error} />
        <button type="submit" className={`btn-whatsapp ${loading ? 'loading' : ''}`} disabled={loading}><Icon name={loading ? 'fa-spinner fa-spin' : 'fa-whatsapp'} brand={!loading} /><span>{loading ? 'جاري الإرسال...' : WHATSAPP_VERIFICATION_ENABLED ? 'إرسال كود التحقق' : 'أرسل على واتساب للتسجيل'}</span></button>
      </ApiForm>}
      <div className="login-security">🔒 بياناتك آمنة ومشفرة<br /><span style={{ fontSize: 10 }}>{WHATSAPP_VERIFICATION_ENABLED ? 'أكد رقمك بالكود المرسل على واتساب للدخول مباشرةً' : 'سيتم مراجعة طلبك خلال دقائق'}</span></div>
    </div></div>
    {picker && <AreaPicker value={area} onSelect={(next) => { form.setValue('area', next, { shouldValidate: true }); setPicker(false); }} onClose={() => setPicker(false)} />}
  </>;
}
