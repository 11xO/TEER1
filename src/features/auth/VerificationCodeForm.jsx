import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiForm, FieldError } from '../../api/forms.jsx';
import { VERIFICATION_CODE_LENGTH, verificationCodeSchema } from '../../api/schemas.js';
import { Icon } from '../../components/ui.jsx';

const CODE_LENGTH = VERIFICATION_CODE_LENGTH;

export default function VerificationCodeForm({ challenge, verification, onVerified, onResend, onBack, submitting = false, error }) {
  const form = useForm({ resolver: zodResolver(z.object({ code: verificationCodeSchema })), defaultValues: { code: '' } });
  const [now, setNow] = useState(Date.now);
  const [confirmedSession, setConfirmedSession] = useState(null);
  const [digits, setDigits] = useState(() => Array(CODE_LENGTH).fill(''));
  const inputs = useRef([]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const remaining = Math.max(0, Math.ceil((challenge.resendAt - now) / 1000));
  const remainingLabel = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const expired = now >= challenge.expiresAt;
  const busy = submitting || verification.verifyMutation.isPending || verification.sendMutation.isPending;
  function updateDigits(next) {
    setDigits(next);
    form.setValue('code', next.join(''), { shouldValidate: next.join('').length === CODE_LENGTH });
  }
  function handleDigit(index, value) {
    const clean = value.replace(/\D/g, '');
    if (clean.length > 1) {
      const pasted = clean.slice(0, CODE_LENGTH - index).split('');
      const next = [...digits];
      pasted.forEach((digit, offset) => { next[index + offset] = digit; });
      updateDigits(next);
      inputs.current[Math.min(index + pasted.length, CODE_LENGTH - 1)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = clean;
    updateDigits(next);
    if (clean && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  }
  function handleKeyDown(index, event) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const next = [...digits];
      next[index - 1] = '';
      updateDigits(next);
    }
  }
  function handlePaste(event) {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    const next = pasted.split('');
    while (next.length < CODE_LENGTH) next.push('');
    updateDigits(next);
    inputs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  }
  async function submit({ code }) {
    if (busy || expired && !confirmedSession) return;
    try {
      const session = confirmedSession || await verification.verifyMutation.mutateAsync({ challengeId: challenge.challengeId, code });
      setConfirmedSession(session);
      await onVerified(session);
    } catch (error) { if (error.name !== 'AbortError') form.setError('root', { message: error.message || 'تعذر تأكيد الكود' }); }
  }
  return <ApiForm form={form} onSubmit={submit}>
    <div className="login-sub">ادخل الكود المرسل على واتساب<br /><b dir="ltr">{challenge.phone}</b></div>
    <div className="verification-code-grid" data-code-length={CODE_LENGTH} onPaste={handlePaste} aria-label={`خانة كود التحقق المكوّن من ${CODE_LENGTH} أرقام`}>
      {digits.map((digit, index) => <input
        {...(index === 0 ? form.register('code') : {})}
        key={index}
        ref={(element) => { inputs.current[index] = element; }}
        className="verification-code"
        id={index === 0 ? 'verification-code' : `verification-code-${index + 1}`}
        aria-label={`رقم ${index + 1} من ${CODE_LENGTH} لكود التحقق`}
        aria-invalid={Boolean(form.formState.errors.code)}
        aria-describedby="verification-error"
        inputMode="numeric"
        autoComplete={index === 0 ? 'one-time-code' : 'off'}
        maxLength={CODE_LENGTH}
        value={digit}
        onChange={(event) => handleDigit(index, event.target.value)}
        onKeyDown={(event) => handleKeyDown(index, event)}
        readOnly={Boolean(confirmedSession)}
      />)}
    </div>
    <FieldError id="verification-error" error={form.formState.errors.code} />
    <FieldError error={form.formState.errors.root || error || (expired && !confirmedSession ? 'انتهت صلاحية الكود. اطلب كود جديد.' : null)} />
    <button type="submit" className={`btn-whatsapp ${busy ? 'loading' : ''}`} disabled={busy || expired && !confirmedSession}><Icon name={busy ? 'fa-spinner fa-spin' : 'fa-shield-alt'} /><span>{busy ? 'جاري التحقق...' : confirmedSession ? 'متابعة التسجيل' : 'تأكيد الكود والمتابعة'}</span></button>
    <div className="verification-actions"><button type="button" disabled={busy || remaining > 0 || Boolean(confirmedSession)} onClick={async () => { form.clearErrors(); await onResend(); }}>{confirmedSession ? 'تم تأكيد الرقم' : remaining ? `إعادة إرسال الكود بعد ${remainingLabel}` : 'إعادة إرسال الكود الآن'}</button><button type="button" disabled={busy} onClick={onBack}>تعديل الرقم</button></div>
  </ApiForm>;
}
