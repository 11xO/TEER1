import { useEffect, useRef, useState } from 'react';
import { useForm, useFormContext, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useApp } from '../../context/AppContext.jsx';
import { Empty, Icon, Loader, Modal, Sheet, SubmitButton } from '../../components/ui.jsx';
import { escapeText, safeUrl, validPhone } from '../../utils/format.js';
import { ApiForm, ApiField, DynamicFields, FieldError } from '../../api/forms.jsx';
import { serviceFormSchema, shippingReceiverFields, shippingSenderFields } from '../../api/schemas.js';

export function AddressPicker({ value, onChange, prefix = 'delivery' }) {
  const { user } = useApp();
  const saved = user.address || '';
  const [mode, setMode] = useState(saved ? 'my' : 'other');
  const form = useFormContext();
  return <div className="field">
    <label className="field-label" htmlFor={`${prefix}-address`}><Icon name="fa-map-marker-alt" /> عنوان التوصيل</label>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
      <button type="button" className={`addr-picker-btn ${mode === 'my' ? 'active' : ''}`} disabled={!saved} onClick={() => { setMode('my'); onChange(saved); }}><Icon name="fa-home" /> مكاني</button>
      <button type="button" className={`addr-picker-btn ${mode === 'other' ? 'active' : ''}`} onClick={() => { setMode('other'); onChange(''); }}><Icon name="fa-map-pin" /> مكان آخر</button>
    </div>
    <input id={`${prefix}-address`} type="text" value={value} onChange={(event) => { setMode('other'); onChange(event.target.value); }} placeholder="اكتب العنوان هنا..." autoComplete="street-address" required />
    <FieldError error={form?.formState.errors.address} />
    <div style={{ fontSize: 10.5, color: saved ? 'var(--text-muted)' : '#dc2626', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name={saved ? 'fa-info-circle' : 'fa-exclamation-circle'} />{saved ? `عنوانك المحفوظ: ${saved}` : 'محتاج تضيف عنوانك من البروفايل عشان تستخدم "مكاني"'}</div>
  </div>;
}
function PriceBox({ price, trip }) {
  return <div className="price-box"><div className="price-box-label"><Icon name="fa-money-bill-wave" /> {trip ? 'سعر الرحلة' : 'سعر التوصيل'}</div><div className="price-box-value">{price}</div></div>;
}
export default function ServiceSheet({ service, onClose }) {
  const { user, pricing, pricingLoading, areaSettings, discounts, submitOrder, canOrder, toast } = useApp();
  const custom = typeof service === 'object' ? service : null;
  const kind = custom ? 'custom-service' : service;
  const form = useForm({ resolver: zodResolver(serviceFormSchema(kind)), defaultValues: { address: user.address || '', destinationId: '', details: '', item: '', fromName: user.name, fromPhone: user.phone, toName: '', toPhone: '', toAddress: '', cod: '' } });
  const values = useWatch({ control: form.control });
  const [destination, setDestination] = useState(null);
  const [destOpen, setDestOpen] = useState(false);
  const [rx, setRx] = useState('');
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const fileInput = useRef(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const readerRef = useRef(null);
  const change = (name) => (value) => form.setValue(name, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  const configs = {
    mishwar: ['طلب مشوار', 'توك توك لباب البيت',     <img key="tuktuk" src="./tuktuk.webp" alt="توك توك" style={{ width: '160%', height: '160%', objectFit: 'cover', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />, '#8b5cf6,#7c3aed'],
    pharma: ['توصيل صيدلية', 'دوا لباب البيت', 'fa-pills', '#06b6d4,#0891b2'],
    vegetables: ['توصيل خضار', 'طازة كل يوم', 'fa-carrot', '#10b981,#059669'],
    custom: ['✨ اطلب أي حاجة', 'هاتلي أي حاجة', 'fa-magic', '#a855f7,#7c3aed'],
    shipping: ['🚚 إرسال شحنة', 'شحن سريع', 'fa-shipping-fast', '#0ea5e9,#06b6d4'],
    'custom-service': [custom?.name || 'خدمة مخصصة', custom?.description || 'اطلب من المكان ده', custom?.icon || 'fa-store', `${custom?.color1 || '#8b5cf6'},${custom?.color2 || '#7c3aed'}`],
  };
  const [title, subtitle, icon, colors] = configs[kind];
  const gradient = `linear-gradient(135deg,${colors})`;
  const tripPrice = destination ? Math.round(Math.max(0, Number(destination.price) - Number(discounts.amount || 0))) : 0;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readerRef.current?.abort(); }; }, []);
  function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('اختار صورة للروشتة', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('الصورة كبيرة!', 'error'); return; }
    const reader = new FileReader(); readerRef.current = reader;
    setReading(true);
    reader.onload = () => { setRx(String(reader.result)); setReading(false); };
    reader.onerror = () => { setReading(false); toast('تعذر قراءة الصورة', 'error'); };
    reader.readAsDataURL(file);
  }
  function numberedLine(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const input = event.currentTarget;
    const pos = input.selectionStart;
    const match = values.details.substring(0, pos).split('\n').at(-1).trim().match(/^(\d+)[-–.)]/);
    const next = match ? Number(match[1]) + 1 : values.details.split('\n').filter((line) => line.trim()).length + 1;
    const addition = `\n${next}- `;
    change('details')(values.details.slice(0, pos) + addition + values.details.slice(input.selectionEnd));
    requestAnimationFrame(() => { if (input.isConnected) input.setSelectionRange(pos + addition.length, pos + addition.length); });
  }
  async function submit(values) {
    if (locked.current || reading || !canOrder()) return;
    if (!values.address.trim()) { toast('اكتب عنوانك', 'error'); return; }
    const liveDestination = destination && pricing.destinations.find((item) => item.id === destination.id);
    if (kind === 'mishwar' && (!liveDestination || !Number.isFinite(Number(liveDestination.price)))) { toast('اختر الوجهة أول', 'error'); return; }
    if (kind === 'shipping' && (!validPhone(values.fromPhone) || !validPhone(values.toPhone))) { toast('اكتب رقم موبايل صحيح من 11 رقم', 'error'); return; }
    if (kind === 'shipping' && (!Number.isFinite(Number(values.cod)) || Number(values.cod) < 0)) { toast('اكتب مبلغ تحصيل صحيح', 'error'); return; }
    const price = kind === 'mishwar' ? Number(liveDestination.price) : kind === 'shipping' ? areaSettings.shippingPrice : pricing.generalDeliveryPrice;
    const data = { from: user.area, to: values.address.trim(), price, originalPrice: price, deliveryFee: price, commission: price * (kind === 'mishwar' ? pricing.tuktukCommission : pricing.delegateCommission) / 100, status: 'ready_for_driver', hasImages: false };
    if (kind === 'mishwar') Object.assign(data, { type: 'مشوار', orderType: 'trip', from: values.address.trim(), to: liveDestination.name });
    if (kind === 'pharma' || kind === 'vegetables') Object.assign(data, { type: kind === 'pharma' ? 'طلب صيدلية' : 'طلب خضار', orderType: kind === 'pharma' ? 'pharma' : 'grocery', details: escapeText(values.details.trim()).replace(/\n/g, '<br>'), ...(rx ? { rxImage: rx, hasRx: true, hasImages: true } : {}) });
    if (kind === 'custom' || custom) Object.assign(data, { type: custom?.name || 'اطلب أي حاجة', orderType: 'custom', itemName: values.item.trim(), details: `${custom ? `المكان: ${escapeText(custom.name)}<br>` : ''}الحاجة: ${escapeText(values.item.trim())}` });
    if (kind === 'shipping') Object.assign(data, { type: 'شحنة', orderType: 'shipping', isShipping: true, fromName: values.fromName.trim(), fromPhone: values.fromPhone, fromAddr: values.address.trim(), toName: values.toName.trim(), toPhone: values.toPhone, toAddr: values.toAddress.trim(), from: values.address.trim(), to: values.toAddress.trim(), details: escapeText(values.details.trim()), commission: price * 0.1, codAmount: Number(values.cod), hasCOD: Number(values.cod) > 0, shipStatus: 'pending',     trackingCode: `TEER-${new Date().getFullYear()}-${String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000).padStart(5, '0')}` });
    locked.current = true; setLoading(true);
    try { if (await submitOrder(data, kind === 'mishwar' ? 'trip' : kind === 'shipping' ? 'none' : 'delivery') && mounted.current) onClose(); }
    finally { locked.current = false; if (mounted.current) setLoading(false); }
  }
  const addressPicker = <AddressPicker prefix={kind} value={values.address} onChange={change('address')} />;
  return <>
    <Sheet id="serviceSheet" title={title} subtitle={subtitle} icon={icon} gradient={gradient} onClose={() => !loading && onClose()}>
      <ApiForm form={form} onSubmit={submit} onInvalid={(errors) => toast(Object.values(errors)[0]?.message || 'راجع البيانات', 'error')}>
        {kind === 'mishwar' && <><input type="hidden" {...form.register('destinationId')} /><FieldError error={form.formState.errors.destinationId} /></>}
        {kind === 'mishwar' && <><div className="field"><label className="field-label"><Icon name="fa-flag-checkered" /> الوجهة</label><button type="button" className={`destination-btn ${destination ? 'filled' : ''}`} onClick={() => setDestOpen(true)}><span>{destination ? <>🎯 {destination.name} <span style={{ color: 'var(--success)', fontWeight: 900 }}>{tripPrice} ج</span></> : 'اختر الوجهة...'}</span><Icon name="fa-chevron-left" /></button></div>{addressPicker}<PriceBox trip price={tripPrice} /></>}
        {(kind === 'pharma' || kind === 'vegetables') && <>
          <ApiField name="details" id="service-details" type="textarea" label="تفاصيل الطلب" icon="fa-list" placeholder={kind === 'pharma' ? '1- دواء\n2- كريم' : '1- كيلو طماطم\n2- نص كيلو بصل'} onKeyDown={numberedLine} />
          {kind === 'pharma' && <div className="field"><label className="field-label"><Icon name="fa-camera" /> صورة الروشتة (اختياري)</label><div className="rx-upload-box"><input ref={fileInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={upload} />{!rx ? <button type="button" className="rx-upload-btn" disabled={reading} onClick={() => fileInput.current.click()}><Icon name={reading ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'} /> ارفع الروشتة</button> : <div className="rx-preview" style={{ display: 'block' }}><img src={rx} alt="صورة الروشتة" /><button type="button" className="rx-preview-remove" onClick={() => setRx('')} aria-label="إزالة الروشتة"><Icon name="fa-times" /></button><div className="rx-preview-info"><Icon name="fa-check" /> تم الرفع</div></div>}</div></div>}
          {addressPicker}<PriceBox price={pricing.generalDeliveryPrice > 0 ? pricing.generalDeliveryPrice : 'غير محدد'} />
        </>}
        {(kind === 'custom' || custom) && <>
          {!custom && <div className="info-card">💡 <b>مثال:</b> عايز حاجة من مكان معين؟ اكتب اسمها وعنوانك.</div>}
          {safeUrl(custom?.link) && <a href={safeUrl(custom.link)} target="_blank" rel="noopener noreferrer" className="shop-link-btn"><Icon name="fa-external-link-alt" /> افتح المكان</a>}
          <ApiField name="item" id="custom-item" label="اسم الحاجة" icon="fa-shopping-bag" placeholder={custom ? 'مثال: شاحن' : ''} />{addressPicker}
          {custom && <div className="field"><label className="field-label" htmlFor="custom-phone"><Icon name="fa-phone" /> رقم للتواصل</label><input id="custom-phone" type="tel" value={user.phone} readOnly style={{ opacity: 0.7 }} /></div>}
          <PriceBox price={pricing.generalDeliveryPrice > 0 ? pricing.generalDeliveryPrice : 'غير محدد'} />
        </>}
        {kind === 'shipping' && <>
          <div className="shipping-info-card"><div className="shipping-info-row"><div className="shipping-info-label"><Icon name="fa-money-bill-wave" /> سعر الشحن</div><div className="shipping-info-value price">{areaSettings.shippingPrice} ج</div></div><div className="shipping-info-row"><div className="shipping-info-label"><Icon name="fa-clock" /> المدة</div><div className="shipping-info-value">{areaSettings.shippingDays} {areaSettings.shippingDays === 1 ? 'يوم' : 'أيام'}</div></div></div>
          <DynamicFields fields={shippingSenderFields} />{addressPicker}
          <DynamicFields fields={shippingReceiverFields} />
        </>}
        <SubmitButton loading={loading} disabled={reading || pricingLoading} style={kind === 'mishwar' ? undefined : { background: gradient }}><Icon name={kind === 'mishwar' ? 'fa-rocket' : 'fa-paper-plane'} /> {kind === 'mishwar' ? 'اطلب الآن' : 'إرسال'}</SubmitButton>
      </ApiForm>
    </Sheet>
    {destOpen && <Modal id="destSheet" title="اختر الوجهة" subtitle="اضغط على الوجهة" icon="fa-map-marked-alt" onClose={() => setDestOpen(false)}>{pricingLoading ? <Loader /> : !pricing.destinations.length ? <Empty icon="fa-map" message="لا توجد وجهات" /> : pricing.destinations.map((entry) => <button key={entry.id} className="dest-option" onClick={() => { setDestination(entry); change('destinationId')(entry.id); setDestOpen(false); toast(`✅ ${entry.name} - ${Math.round(Math.max(0, Number(entry.price) - Number(discounts.amount || 0)))} ج`, 'success'); }}><span className="name">📍 {entry.name}</span><span className="price">{Math.round(Math.max(0, Number(entry.price) - Number(discounts.amount || 0)))} ج</span></button>)}</Modal>}
  </>;
}
