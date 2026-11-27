import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useVerification } from '../../api/useVerification.js';
import { WHATSAPP_VERIFICATION_ENABLED } from '../../api/http.js';
import { Icon, Loader } from '../../components/ui.jsx';
import { FieldError } from '../../api/forms.jsx';
import { whatsappUrl } from '../../utils/format.js';
import VerificationCodeForm from './VerificationCodeForm.jsx';
import { isRememberedVerifiedPhone, rememberVerifiedPhone } from '../../services/storage.js';
import { LOCAL_TEST_OTP_ENABLED } from '../../api/schemas.js';

export default function ProtectedUI({ children }) {
  const { user, pending, verificationSession, support } = useApp();
  const verification = useVerification();
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState(null);
  const phone = user?.phone || (pending?.status === 'approved' ? pending.phone : null);
  if (!WHATSAPP_VERIFICATION_ENABLED || !phone) return children;
  if (LOCAL_TEST_OTP_ENABLED && isRememberedVerifiedPhone(phone)) return children;
  if (verificationSession.isPending) return <Loader message="جاري التحقق من الجلسة..." />;
  if (verificationSession.isError) return <div className="waiting-screen"><div className="waiting-card"><p className="waiting-desc">تعذر التحقق من الجلسة. تأكد من اتصالك.</p><button className="btn-main" onClick={() => verificationSession.refetch()}>إعادة المحاولة</button></div></div>;
  if (verificationSession.data?.verified && verificationSession.data.phone === phone) return children;
  async function send() {
    setError(null);
    const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
    try {
      setChallenge(await verification.sendMutation.mutateAsync({ phone }));
      if (popup) popup.location.replace(whatsappUrl(support, 'طلب كود التحقق من TEER'));
    } catch (error) {
      popup?.close();
      if (error.name !== 'AbortError') setError(error.message);
    }
  }
  return <div className="login-screen"><div className="login-card"><div className="login-logo-wrap"><div className="login-logo-bg" /><img src="./logo.webp" alt="Teer" className="login-logo" /></div><div className="login-title">كود التحقق</div>
    {challenge ? <VerificationCodeForm challenge={challenge} verification={verification} onVerified={() => { rememberVerifiedPhone(phone); verificationSession.refetch(); }} onResend={send} onBack={() => { verification.reset(); setChallenge(null); setError(null); }} error={error} /> : <><div className="login-sub">افتح واتساب وابعت هترسل الكود لك<br /><b dir="ltr">{phone}</b></div><FieldError error={error} /><button className="btn-whatsapp" disabled={verification.sendMutation.isPending} onClick={send}><Icon name={verification.sendMutation.isPending ? 'fa-spinner fa-spin' : 'fa-whatsapp'} brand={!verification.sendMutation.isPending} /> إرسال كود التحقق على واتساب</button></>}
  </div></div>;
}
