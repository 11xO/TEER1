import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useDatabaseValue } from '../../hooks/useDatabaseValue.js';
import { enabled, entries, escapeText, ordered } from '../../utils/format.js';
import { Empty, Icon, Loader, Sheet, SubmitButton } from '../../components/ui.jsx';
import { AddressPicker } from '../orders/ServiceSheet.jsx';
import { storage } from '../../services/storage.js';
import ThemeToggle from '../../components/ThemeToggle.jsx';

export default function MarketPage() {
  const { user, pricing, discounts, navigate, canOrder, toast, submitOrder } = useApp();
  const categorySource = useDatabaseValue(`market_categories/${user.area}`);
  const productSource = useDatabaseValue(`market_products/${user.area}`);
  const key = `teer_cart:${user.phone}:${user.area}`;
  const [cart, setCart] = useState(() => {
    const saved = storage.json(key, {});
    return Object.fromEntries(Object.entries(saved).filter(([, qty]) => Number.isSafeInteger(qty) && qty > 0));
  });
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [address, setAddress] = useState(user.address || '');
  const [submitting, setSubmitting] = useState(false);
  const [added, setAdded] = useState(false);
  const toastTimer = useRef(null);
  const lock = useRef(false);
  useEffect(() => { storage.set(key, JSON.stringify(cart)); }, [key, cart]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const categories = useMemo(() => ordered(entries(categorySource.value).filter((item) => enabled(item.active))), [categorySource.value]);
  const allProducts = useMemo(() => ordered(entries(productSource.value).filter((item) => item.name && enabled(item.active))), [productSource.value]);
  const available = (product) => product && enabled(product.active) && product.outOfStock !== true && product.outOfStock !== 'true' && Number.isFinite(Number(product.price)) && Number(product.price) >= 0;
  const products = allProducts.filter((product) => (category === 'all' || product.categoryId === category) && product.name.toLowerCase().includes(search.trim().toLowerCase()));
  const cartItems = Object.entries(cart).map(([id, qty]) => ({ id, qty, product: allProducts.find((product) => product.id === id) }));
  const count = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.qty * (Number(item.product?.price) || 0), 0);
  const delivery = Math.max(0, pricing.generalDeliveryPrice);
  const total = subtotal + (discounts.coupon ? 0 : delivery);
  function quantity(id, change) {
    if (submitting) return;
    if (change > 0 && !available(allProducts.find((product) => product.id === id))) { toast('المنتج غير متاح حالياً', 'error'); return; }
    setCart((current) => { const next = { ...current }; const qty = (next[id] || 0) + change; if (qty > 0) next[id] = qty; else delete next[id]; return next; });
    if (change > 0) { setAdded(true); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setAdded(false), 1200); }
  }
  async function checkout(event) {
    event.preventDefault();
    if (lock.current || !canOrder()) return;
    if (!cartItems.length || productSource.loading || productSource.error || cartItems.some((item) => !available(item.product))) { toast('راجع المنتجات المتاحة في السلة', 'error'); return; }
    if (!address.trim()) { toast('اكتب العنوان', 'error'); return; }
    const items = cartItems.map(({ id, qty, product }) => ({ productId: id, name: product.name, price: Number(product.price), qty }));
    lock.current = true; setSubmitting(true);
    try {
      const success = await submitOrder({ type: 'طلب ماركت', orderType: 'market', items, details: items.map((item) => `${item.qty} × ${escapeText(item.name)}`).join('<br>'), from: 'ماركت Teer', to: address.trim(), price: subtotal + delivery, originalPrice: subtotal + delivery, deliveryFee: delivery, itemsTotal: subtotal, commission: delivery * pricing.delegateCommission / 100, status: 'ready_for_driver', hasImages: false }, 'delivery');
      if (success) { storage.set(key, '{}'); setCart({}); setCartOpen(false); }
    } finally { lock.current = false; setSubmitting(false); }
  }
  return <>
    <div className="page active" id="page-market">
      <div className="market-header"><div className="market-header-top"><button className="market-back-btn" onClick={() => navigate('home')} aria-label="رجوع"><Icon name="fa-arrow-right" /></button>            <div className="market-title-box"><div className="market-title"><Icon name="fa-shopping-basket" /> ماركت Teer</div><div className="market-subtitle">تسوق أونلاين</div></div><ThemeToggle /><button className="market-cart-btn" aria-label="سلة المشتريات" onClick={() => setCartOpen(true)}><Icon name="fa-shopping-cart" />{count > 0 && <span className="market-cart-badge">{count}</span>}</button></div><div className="market-search-box"><input type="text" placeholder="ابحث عن منتج..." aria-label="ابحث عن منتج" value={search} onChange={(event) => setSearch(event.target.value)} /><Icon name="fa-search" /></div></div>
      <div className="market-categories"><button className={`cat-chip ${category === 'all' ? 'active' : ''}`} onClick={() => setCategory('all')}>🛍️ الكل</button>{categories.map((item) => <button key={item.id} className={`cat-chip ${category === item.id ? 'active' : ''}`} onClick={() => setCategory(item.id)}>{item.icon || '📦'} {item.name || 'تصنيف'}</button>)}</div>
      <div className="market-grid">{productSource.loading ? <Loader /> : productSource.error ? <Empty icon="fa-wifi" message="تعذر تحميل المنتجات، تحقق من الاتصال" /> : !products.length ? <div className="market-empty"><Icon name="fa-box-open" /><p>لا توجد منتجات</p></div> : products.map((product) => <div className="product-card" key={product.id}>
        <div className="product-image-box">{product.image ? <img src={product.image} className="product-image" loading="lazy" alt={product.name} /> : <div className="product-no-image"><Icon name="fa-image" /></div>}{!available(product) && <span className="product-badge out">خلص</span>}</div>
        <div className="product-info"><div className="product-name">{product.name}</div><div className="product-bottom"><span className="product-price">{Number(product.price) || 0}</span>{!available(product) ? <button className="product-add-btn disabled" disabled aria-label="غير متاح"><Icon name="fa-ban" /></button> : cart[product.id] ? <div className="product-qty-control"><button className="product-qty-btn" onClick={() => quantity(product.id, -1)} aria-label={`تقليل ${product.name}`}>−</button><span className="product-qty-num">{cart[product.id]}</span><button className="product-qty-btn" onClick={() => quantity(product.id, 1)} aria-label={`زيادة ${product.name}`}>+</button></div> : <button className="product-add-btn" onClick={() => quantity(product.id, 1)} aria-label={`إضافة ${product.name}`}><Icon name="fa-plus" /></button>}</div></div>
      </div>)}</div>
      {count > 0 && <div className="market-cart-bar show" onClick={() => setCartOpen(true)} role="button" tabIndex={0} onKeyDown={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setCartOpen(true); } }}><div className="market-cart-bar-icon"><Icon name="fa-shopping-bag" /></div><div className="market-cart-bar-info"><div className="market-cart-bar-count">{count} منتج</div><div className="market-cart-bar-total">{subtotal}</div></div><div className="market-cart-bar-action">إتمام <Icon name="fa-arrow-left" /></div></div>}
    </div>
    <div className={`cart-toast-notif ${added ? 'show' : ''}`} role="status"><Icon name="fa-check-circle" /> أضفت!</div>
    {cartOpen && <Sheet id="cartSheet" title="سلة المشتريات" subtitle={`${cartItems.length} منتج`} icon="fa-shopping-cart" gradient="linear-gradient(135deg,#10b981,#059669)" onClose={() => !submitting && setCartOpen(false)}>
      {!cartItems.length ? <div className="market-empty"><Icon name="fa-shopping-bag" /><p>السلة فاضية</p></div> : <form onSubmit={checkout}>
        {cartItems.map(({ id, product, qty }) => <div className="cart-item-row" key={id}><div className="cart-item-info"><div className="cart-item-name">{product?.name || 'منتج غير متاح'}</div><div className="cart-item-price">{product?.price || 0} × {qty}</div></div><div className="cart-item-controls"><div className="cart-qty-control"><button type="button" className="cart-qty-btn" disabled={submitting} onClick={() => quantity(id, -1)} aria-label="تقليل الكمية">−</button><span className="cart-qty-num">{qty}</span><button type="button" className="cart-qty-btn" disabled={submitting || !available(product)} onClick={() => quantity(id, 1)} aria-label="زيادة الكمية">+</button></div><button type="button" className="cart-remove-btn" disabled={submitting} onClick={() => quantity(id, -qty)} aria-label="حذف المنتج"><Icon name="fa-trash" /></button></div></div>)}
        <div className="cart-summary-box"><div className="cart-summary-row"><span>المنتجات</span><span>{subtotal} ج</span></div><div className="cart-summary-row"><span>🛵 التوصيل</span><span>{delivery} ج</span></div>{discounts.coupon && <div className="cart-summary-row" style={{ color: 'var(--success)' }}><span>🎫 توصيل مجاني</span><span>- {delivery} ج</span></div>}<div className="cart-summary-row total"><span>الإجمالي</span><span>{total}</span></div></div>
        <div style={{ marginTop: 16 }}><AddressPicker value={address} onChange={setAddress} prefix="market" /></div><SubmitButton loading={submitting} disabled={productSource.loading || Boolean(productSource.error)} style={{ marginTop: 8 }}><Icon name="fa-paper-plane" /> إتمام ({total} ج)</SubmitButton>
      </form>}
    </Sheet>}
  </>;
}
