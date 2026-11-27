import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { Icon, Loader } from '../../components/ui.jsx';
import { whatsappUrl } from '../../utils/format.js';
import { registrationMessage } from './LoginScreen.jsx';
import { WHATSAPP_VERIFICATION_ENABLED } from '../../api/http.js';

export default function WaitingScreen() {
  const { pending, pendingLoading, pendingError, manualApproval, waitingMinutes, support, cancelRegistration, backToRegistration, confirm, toast } = useApp();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, waitingMinutes * 60 - Math.floor((now - (pending?.requestedAt || now)) / 1000));
  const countdown = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const status = pending?.status;
  let content;
  if (pendingLoading) content = <Loader />;
  else if (pendingError) content = <><div className="waiting-title">تعذر تحميل طلبك</div><p className="waiting-desc">تأكد من اتصالك بالإنترنت وحاول تاني</p><button className="btn-main" onClick={() => location.reload()}>إعادة المحاولة</button></>;
  else if (status === 'approved') content = <div className="waiting-approved"><div className="waiting-approved-icon"><Icon name="fa-check" /></div><div className="waiting-approved-title">🎉 تمت الموافقة!</div><div className="waiting-approved-desc">أهلاً بيك <b style={{ color: 'var(--text)' }}>{pending.name}</b><br />جاري تسجيل دخولك...</div></div>;
  else if (status !== 'pending') {
    const banned = status === 'banned';
    const rejected = status === 'rejected';
    content = <><div style={{ width: 90, height: 90, borderRadius: 30, background: `linear-gradient(135deg,${banned ? '#64748b,#334155' : rejected ? '#ef4444,#b91c1c' : '#f59e0b,#d97706'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42, color: '#fff', margin: '0 auto 20px' }}><Icon name={banned ? 'fa-user-slash' : rejected ? 'fa-times' : 'fa-clock'} /></div><div style={{ fontSize: 22, fontWeight: 900, color: banned ? 'var(--text-soft)' : rejected ? '#dc2626' : '#b45309', marginBottom: 12 }}>{banned ? '🚫 رقمك محظور' : rejected ? '❌ تم رفض طلبك' : '⏰ انتهى وقت المراجعة'}</div>{(banned || rejected) && <div className="waiting-desc">{banned ? 'للأسف، الرقم ده محظور.' : pending.rejectReason || 'مشكلة في البيانات'}</div>}{!banned && <button className="btn-main" onClick={backToRegistration}><Icon name="fa-redo" /> حاول تاني</button>}</>;
  } else content = <>
    <div className="waiting-status-badge" style={manualApproval ? { background: 'rgba(59,130,246,.12)', borderColor: 'rgba(59,130,246,.4)', color: '#2563eb' } : undefined}><span className="pulse-dot" style={manualApproval ? { background: '#2563eb' } : undefined} />{manualApproval ? 'في انتظار المراجعة اليدوية' : 'جاري المراجعة الآن...'}</div>
    {manualApproval ? <div style={{ width: 120, height: 120, borderRadius: 36, background: 'linear-gradient(135deg,#3b82f6,#2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, color: '#fff', margin: '20px auto', boxShadow: '0 15px 40px rgba(59,130,246,.35)', animation: 'approvedIconBounce 2s infinite' }}><Icon name="fa-user-shield" /></div> : <div className="waiting-circle-wrap"><svg className="waiting-circle-svg" viewBox="0 0 170 170"><defs><linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="50%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#10b981" /></linearGradient></defs><circle className="bg-circle" cx="85" cy="85" r="75" /><circle className="progress-circle" cx="85" cy="85" r="75" style={{ strokeDashoffset: 471 * (1 - seconds / (waitingMinutes * 60)) }} /></svg><div className="waiting-circle-inner"><div className="waiting-timer-display">{countdown}</div><div className="waiting-timer-label">متبقي</div></div></div>}
    <div className="waiting-title">⏳ جاري المراجعة</div><div className="waiting-desc">{manualApproval ? 'طلبك وصل لفريقنا' : 'بعتنا طلبك وجاري المراجعة'}<br /><b style={manualApproval ? { color: '#2563eb' } : undefined}>{manualApproval ? 'هيتم التواصل معاك قريباً' : `هيتم الموافقة خلال ${waitingMinutes} دقايق`}</b></div>
    <div className="whatsapp-sent-card"><div className="whatsapp-sent-icon"><Icon name="fa-whatsapp" brand /></div><div className="whatsapp-sent-text"><div className="whatsapp-sent-title"><span className="check-mark"><Icon name="fa-check" /></span> {WHATSAPP_VERIFICATION_ENABLED ? 'تم تأكيد رقم واتساب' : 'تم فتح الواتساب'}</div><div className="whatsapp-sent-sub">{WHATSAPP_VERIFICATION_ENABLED ? 'طلبك اتسجل وفريقنا هيراجعه' : 'ابعت الرسالة الجاهزة للأدمن'}</div></div></div>
    <a href={whatsappUrl(support, WHATSAPP_VERIFICATION_ENABLED ? 'السلام عليكم، محتاج مساعدة في مراجعة تسجيلي' : registrationMessage(pending))} target="_blank" rel="noopener noreferrer" className="reopen-whatsapp-btn" style={{ textDecoration: 'none' }}><Icon name="fa-whatsapp" brand /><span>{WHATSAPP_VERIFICATION_ENABLED ? 'تواصل مع الدعم' : 'افتح الواتساب تاني'}</span></a>
    <div className="waiting-note-new"><div className="note-icon"><Icon name="fa-lightbulb" /></div><div><b>💡 نصيحة</b> {WHATSAPP_VERIFICATION_ENABLED ? 'طلبك في انتظار موافقة فريق طير' : 'لو بعت الرسالة، الموافقة هتكون أسرع بكثير'}</div></div><button className="waiting-cancel" onClick={() => confirm('إلغاء التسجيل', 'متأكد؟', async () => { try { await cancelRegistration(); } catch { toast('تعذر إلغاء الطلب، حاول تاني', 'error'); } })}><Icon name="fa-times" /> إلغاء الطلب</button>
  </>;
  return <div className="waiting-screen" id="waitingSection"><div className="waiting-card">{content}</div></div>;
}
