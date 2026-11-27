import { useApp } from '../../context/AppContext.jsx';
import { Empty, Icon, Loader, PageHeader } from '../../components/ui.jsx';
export default function ShippingPage() {
  const { orders, ordersLoading, ordersError } = useApp();
  const list = orders.filter((order) => order.isShipping).sort((a, b) => (b.time || 0) - (a.time || 0));
  const statuses = { pending: 'في انتظار المندوب', accepted: 'تم القبول', picked_up: 'تم الاستلام', in_transit: 'في الطريق', delivered: 'تم التسليم', cancelled: 'ملغية' };
  return <div className="page active" id="page-shipping"><PageHeader title="طلبات الشحن" emoji="🚚" /><div style={{ paddingTop: 15 }}>
    {ordersLoading ? <Loader /> : ordersError ? <Empty icon="fa-wifi" message="تعذر تحميل الشحنات، تأكد من الاتصال" /> : !list.length ? <Empty icon="fa-shipping-fast" message="لا توجد شحنات" /> : list.map((order) => <div key={order.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, marginBottom: 14, boxShadow: 'var(--shadow-sm)' }}><div style={{ display: 'inline-flex', padding: '5px 12px', background: 'linear-gradient(135deg,#0ea5e9,#06b6d4)', color: '#fff', borderRadius: 12, fontSize: 11, fontWeight: 900, marginBottom: 8 }}><Icon name="fa-barcode" /> {order.trackingCode || '-'}</div><div style={{ fontSize: 16, fontWeight: 900, color: 'var(--success)', float: 'left' }}>{order.price || 0} ج</div><div style={{ clear: 'both' }} /><div style={{ background: 'var(--bg-soft)', borderRadius: 14, padding: 12, margin: '10px 0', fontSize: 12 }}><div>📍 من: <b style={{ color: 'var(--text)' }}>{order.fromAddr || '-'}</b></div><div style={{ marginTop: 6 }}>🎯 إلى: <b style={{ color: 'var(--text)' }}>{order.toAddr || '-'}</b></div></div><div style={{ color: '#b45309', fontWeight: 900, fontSize: 12 }}>{statuses[order.shipStatus || 'pending'] || statuses.pending}</div></div>)}
  </div></div>;
}
