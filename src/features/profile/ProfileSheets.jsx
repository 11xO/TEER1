import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import AreaPicker from '../../components/AreaPicker.jsx';
import SocialLinks from '../../components/SocialLinks.jsx';
import { Icon, Sheet } from '../../components/ui.jsx';
import { ProfileAction } from './ProfilePage.jsx';

function AddressEditor() {
  const { user, updateProfile, setProfileSheet, toast } = useApp();
  const [draft, setDraft] = useState(user.address || '');
  const [status, setStatus] = useState('جاهز');
  const [picker, setPicker] = useState(false);
  const timer = useRef(null);
  const draftRef = useRef(draft);
  const saved = useRef(user.address || '');
  const saver = useRef(updateProfile);
  const saving = useRef(Promise.resolve());
  const mounted = useRef(true);
  saver.current = updateProfile;
  const save = useRef(null);
  save.current = () => {
    clearTimeout(timer.current);
    const address = draftRef.current.trim();
    if (address === saved.current) return saving.current;
    if (address.length < 3) { if (mounted.current) setStatus('قصير جداً'); return Promise.resolve(false); }
    saving.current = saving.current.catch(() => {}).then(async () => {
      if (address === saved.current) return true;
      try {
        await saver.current({ address }); saved.current = address;
        if (mounted.current && draftRef.current.trim() === address) setStatus('تم الحفظ ✓');
        return true;
      } catch { if (mounted.current) setStatus('فشل الحفظ'); return false; }
    });
    return saving.current;
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); save.current(); };
  }, []);
  async function close() {
    const result = await save.current();
    if (result === false && draftRef.current.trim().length >= 3) { toast('تعذر حفظ العنوان، حاول تاني', 'error'); return; }
    setProfileSheet(null);
  }
  return <>
    <Sheet id="addressSheet" title="🏠 عنواني" subtitle="بيتحفظ تلقائياً" icon="fa-home" gradient="linear-gradient(135deg,#10b981,#059669)" onClose={close}>
      <div className="info-card" style={{ background: 'rgba(16,185,129,.08)', borderColor: 'rgba(16,185,129,.3)' }}><Icon name="fa-magic" style={{ color: '#059669' }} /> <b>حفظ تلقائي:</b> أي تغيير بتعمله بيتحفظ لوحده — مش محتاج تدوس على أي زر</div>
      <div className="field"><label className="field-label"><Icon name="fa-map-marker-alt" /> المنطقة</label><button type="button" className="destination-btn" onClick={() => setPicker(true)}><span>📍 {user.area || 'اختر منطقتك...'}</span><Icon name="fa-chevron-left" /></button></div>
      <div className="field"><label className="field-label" htmlFor="edit-address"><Icon name="fa-home" /> العنوان بالتفصيل<span style={{ marginRight: 'auto', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }} role="status"><Icon name={status === 'بيتحفظ...' ? 'fa-circle-notch fa-spin' : 'fa-check-circle'} style={{ color: status.startsWith('تم') ? '#10b981' : '#94a3b8', fontSize: 10 }} /><span>{status}</span></span></label><textarea id="edit-address" placeholder="الشارع، رقم العمارة، الدور، علامة مميزة..." style={{ minHeight: 100 }} value={draft} onChange={(event) => { const value = event.target.value; setDraft(value); draftRef.current = value; setStatus('بيتحفظ...'); clearTimeout(timer.current); timer.current = setTimeout(() => save.current(), 1200); }} /></div>
      <div style={{ textAlign: 'center', padding: '14px 0 4px' }}><div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Icon name="fa-shield-alt" style={{ color: '#10b981' }} /> بياناتك بتتحفظ تلقائياً في مكان آمن</div></div>
    </Sheet>
    {picker && <AreaPicker value={user.area} onClose={() => setPicker(false)} onSelect={async (area) => { setPicker(false); try { await save.current(); await updateProfile({ area }); toast(`✅ تم حفظ: ${area}`, 'success'); } catch { toast('❌ فشل الحفظ', 'error'); } }} />}
  </>;
}
export default function ProfileSheets() {
  const { profileSheet, setProfileSheet, user, updateProfile, supportUrl, logout, toast } = useApp();
  const [picker, setPicker] = useState(false);
  if (profileSheet === 'address') return <AddressEditor />;
  if (profileSheet !== 'settings') return null;
  return <><Sheet id="settingsSheet" title="الإعدادات" subtitle="اضبط إعداداتك" icon="fa-cog" gradient="linear-gradient(135deg,#8b5cf6,#7c3aed)" onClose={() => setProfileSheet(null)}><div className="profile-list" style={{ margin: 0 }}><ProfileAction icon="fa-map-marker-alt" colors="#f59e0b,#d97706" title="تغيير المنطقة" subtitle={`الحالية: ${user.area || '-'}`} onClick={() => setPicker(true)} /><ProfileAction icon="fa-home" colors="#10b981,#059669" title="تعديل عنواني" subtitle={user.address ? user.address.length > 30 ? `${user.address.slice(0, 30)}...` : user.address : 'غير محدد'} onClick={() => setProfileSheet('address')} /><ProfileAction icon="fa-whatsapp" colors="#25D366,#128C7E" title="الدعم الفني" href={supportUrl} /><ProfileAction icon="fa-sign-out-alt" colors="#ef4444,#b91c1c" title="تسجيل الخروج" onClick={logout} /></div><div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 8px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="fa-share-alt" style={{ color: 'var(--primary)' }} /> تابعنا</div><SocialLinks /></Sheet>
    {picker && <AreaPicker value={user.area} onClose={() => setPicker(false)} onSelect={async (area) => { try { await updateProfile({ area }); setPicker(false); toast('✅ تم تغيير المنطقة', 'success'); } catch { toast('❌ فشل الحفظ', 'error'); } }} />}
  </>;
}
