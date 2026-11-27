import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { Empty, Icon, Loader, PageHeader } from '../../components/ui.jsx';
import RichLines from '../../components/RichLines.jsx';
import { cleanPhone, orderAppearance } from '../../utils/format.js';
import { visibleOrders } from '../../utils/orders.js';
import { collectionPage } from '../../api/collection.js';
import { CollectionSearch, Pagination } from '../../api/CollectionControls.jsx';

export default function OrdersPage() {
  const { orders, ordersLoading, ordersError, user, cancelOrder } = useApp();
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const result = collectionPage(visibleOrders(orders, user.phone, tab === 'history'), { page, search, predicate: (order) => statusFilter === 'all' || order.status === statusFilter });
  const list = result.items;
  const changeTab = (next) => { setTab(next); setStatusFilter('all'); setPage(1); };
  return <div className="page active" id="page-orders"><PageHeader title="طلباتي" emoji="📦" /><div className="sub-tabs" style={{ marginTop: 15 }}><button className={`sub-tab ${tab === 'active' ? 'active' : ''}`} onClick={() => changeTab('active')}><Icon name="fa-clock" /> الحالية</button><button className={`sub-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => changeTab('history')}><Icon name="fa-history" /> السجل</button></div>
    <CollectionSearch search={search} onSearch={(value) => { setSearch(value); setPage(1); }} status={statusFilter} onStatus={(value) => { setStatusFilter(value); setPage(1); }} statuses={tab === 'active' ? [['ready_for_driver', 'في انتظار المندوب'], ['active', 'في الطريق']] : [['completed', 'تم التسليم'], ['cancelled', 'ملغي']]} />
    {ordersLoading ? <Loader /> : ordersError ? <Empty icon="fa-wifi" message="تعذر تحميل الطلبات، تأكد من الاتصال" /> : !list.length ? <Empty icon={tab === 'active' ? 'fa-box' : 'fa-history'} message={tab === 'active' ? 'لا توجد طلبات حالية' : 'السجل فاضي'} /> : list.map((order) => {
      const appearance = orderAppearance(order.type);
      const [status, statusText] = { ready_for_driver: ['waiting', 'في انتظار المندوب'], active: ['active', 'في الطريق'], completed: ['done', 'تم التسليم'], cancelled: ['pending', 'ملغي'] }[order.status] || ['waiting', 'في انتظار المندوب'];
      return <div className="order-item" key={order.id} style={{ '--oa': appearance.color }}><div className="order-top"><div className="order-type"><div className="order-icon-mini" style={{ background: appearance.color }}>{appearance.image ?       <img src="./tuktuk.webp" alt="توك توك" style={{ width: '160%', height: '160%', objectFit: 'cover', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} /> : <Icon name={appearance.icon} />}</div><div><div className="order-name">{order.type}</div><div className="order-time">{order.orderTimeString || ''}</div></div></div><span className={`order-status-badge status-${status}`}>{statusText}</span></div><div className="order-details"><RichLines text={order.details || order.to || ''} /></div>
        {order.status === 'active' && order.driverPhone && <div className="order-details" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', marginTop: 8 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><Icon name="fa-phone" style={{ color: '#059669', fontSize: 14 }} /><span style={{ color: 'var(--text-soft)', fontWeight: 700 }}>رقم الكابتن:</span><a href={`tel:${cleanPhone(order.driverPhone)}`} style={{ color: '#059669', fontWeight: 900, fontSize: 14, textDecoration: 'none', direction: 'ltr' }}>{order.driverPhone}</a></div></div>}
        <div className="order-footer"><span /><span className="order-price">{order.price || 0}</span></div>{order.status === 'ready_for_driver' && <button className="btn-cancel-order" onClick={() => cancelOrder(order.id)}><Icon name="fa-times" /> إلغاء الطلب</button>}
      </div>;
    })}
    <Pagination page={result.page} totalPages={result.totalPages} onPage={setPage} />
  </div>;
}
