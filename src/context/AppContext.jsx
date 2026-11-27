import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../features/auth/useAuth.js';
import { useOnline } from '../hooks/useOnline.js';
import { useDatabaseValue } from '../hooks/useDatabaseValue.js';
import { create, patch, read, transaction, write } from '../api/firebase.js';
import { cancelCustomerOrder, claimCard, deductPoints, placeOrder, rewardInvite } from '../api/orders.js';
import { storage } from '../services/storage.js';
import { enabled, entries, ordered, safeUrl, weekKey, whatsappUrl, withinWorkHours } from '../utils/format.js';
import { DEFAULT_REWARDS } from '../utils/orders.js';
import { useMutation } from '@tanstack/react-query';

const AppContext = createContext(null);
const EMPTY = Object.freeze({});
const EMPTY_DISCOUNTS = Object.freeze({ coupon: false, amount: 0, couponCost: 0, amountCost: 0 });
const pages = ['home', 'orders', 'shipping', 'rewards', 'profile', 'market'];
export function AppProvider({ children }) {
  const [notice, setNotice] = useState(null);
  const toast = useCallback((message, type = 'info') => setNotice({ message, type, id: Date.now() }), []);
  const auth = useAuth(toast);
  const { user, suspended } = auth;
  const online = useOnline();
  const [page, setPage] = useState(() => pages.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home');
  const [service, setService] = useState(null);
  const [profileSheet, setProfileSheet] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [success, setSuccess] = useState(null);
  const [celebration, setCelebration] = useState(0);
  const [notification, setNotification] = useState(null);
  const operation = useRef(false);
  const session = useRef('');
  const seenNotifications = useRef(new Set());
  const area = user?.area;
  const phone = user?.phone;
  const orderMutation = useMutation({ mutationKey: ['orders', 'create', phone], mutationFn: ({ data, customer, settings, discounts, kind, challenge }) => placeOrder(data, customer, settings, discounts, kind, challenge), retry: false });
  const cancellationMutation = useMutation({ mutationKey: ['orders', 'cancel', phone], mutationFn: ({ id, phone }) => cancelCustomerOrder(id, phone), retry: false });
  session.current = `${phone || ''}:${area || ''}`;
  const rewardSource = useDatabaseValue(area ? `reward_settings/${area}` : null, EMPTY);
  const settingsSource = useDatabaseValue(area ? `settings/${area}` : null, EMPTY);
  const pricingSource = useDatabaseValue(area ? `pricing/${area}` : null, EMPTY);
  const pointsSource = useDatabaseValue(phone ? `users_points/${phone}` : null, 0);
  const ordersSource = useDatabaseValue(phone ? 'orders' : null, EMPTY);
  const shopsSource = useDatabaseValue(area ? `shops/${area}` : null, EMPTY);
  const servicesSource = useDatabaseValue(area ? `custom_services/${area}` : null, EMPTY);
  const areasSource = useDatabaseValue('areas', EMPTY);
  const socialSource = useDatabaseValue('settings/social', EMPTY);
  const supportSource = useDatabaseValue('settings/support/whatsapp', '01115699940');
  const workHoursSource = useDatabaseValue('settings/work_hours', EMPTY);
  const challengeSource = useDatabaseValue(phone ? `users_challenges/${phone}/${weekKey()}` : null, EMPTY);
  const notificationsSource = useDatabaseValue(phone ? `user_notifications/${phone}` : null, EMPTY);
  const [clock, setClock] = useState(() => new Date());
  const [inviteCode, setInviteCode] = useState('------');
  const rewards = { ...DEFAULT_REWARDS, ...rewardSource.value };
  const areaSettings = { ...settingsSource.value, shippingPrice: Number(settingsSource.value.shippingPrice ?? 30), shippingDays: Number(settingsSource.value.shippingDays ?? 3) };
  const pricing = { generalDeliveryPrice: Number(pricingSource.value.generalDeliveryPrice ?? 0), tuktukCommission: Number(pricingSource.value.tuktukCommission ?? 10), delegateCommission: Number(pricingSource.value.delegateCommission ?? 10), destinations: entries(pricingSource.value.destinations).filter((item) => item.name) };
  const discountKey = phone ? `teer_discounts:${phone}` : '';
  const [discountState, setDiscountState] = useState(() => ({ key: '', value: EMPTY_DISCOUNTS }));
  const discounts = discountState.key === discountKey ? discountState.value : storage.json(discountKey, EMPTY_DISCOUNTS);
  const setDiscounts = (next) => {
    storage.set(discountKey, JSON.stringify(next)); setDiscountState({ key: discountKey, value: next });
  };
  const confirm = (title, message, action) => setConfirmation({ title, message, action });
  const navigate = useCallback((next) => {
    if (!pages.includes(next)) return;
    setPage(next);
    if (location.hash !== `#${next}`) location.hash = next;
    window.scrollTo(0, 0);
  }, []);
  const closed = workHoursSource.value.enabled && !withinWorkHours(workHoursSource.value.openTime, workHoursSource.value.closeTime, clock);

  useEffect(() => {
    const sync = () => { const next = location.hash.slice(1); setPage(pages.includes(next) ? next : 'home'); setService(null); setProfileSheet(null); };
    window.addEventListener('hashchange', sync);
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => { window.removeEventListener('hashchange', sync); clearInterval(timer); };
  }, []);
  useEffect(() => { if (!notice) return undefined; const timer = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!notification) return undefined; const timer = setTimeout(() => setNotification(null), 8000); return () => clearTimeout(timer); }, [notification]);
  useEffect(() => {
    if (!phone || pointsSource.loading || pointsSource.error) return;
    write(`customers/${phone}/points`, Number(pointsSource.value) || 0, 'secondary').catch(() => {});
  }, [phone, pointsSource.value, pointsSource.loading, pointsSource.error]);
  useEffect(() => {
    if (!phone) return;
    for (const item of entries(notificationsSource.value)) {
      const key = `${phone}:${item.id}`;
      if (!item.read && !seenNotifications.current.has(key)) {
        seenNotifications.current.add(key); setNotification(item);
        write(`user_notifications/${phone}/${item.id}/read`, true).catch(() => { seenNotifications.current.delete(key); });
      }
    }
  }, [notificationsSource.value, phone]);
  useEffect(() => {
    if (!phone || !enabled(rewards.inviteActive)) return undefined;
    let active = true;
    read(`my_invite_codes/${phone}`).then(async (existing) => {
      let code = existing;
      if (!code) {
        // Keep existing codes; reserve new codes without phone-suffix collisions.
        code = `TEER${phone.slice(-4)}`;
        const owner = await read(`invite_codes/${code}`);
        if (owner && owner !== phone) code = `TEER${phone}`;
        await patch('/', { [`my_invite_codes/${phone}`]: code, [`invite_codes/${code}`]: phone });
      }
      if (active) setInviteCode(code);
    }).catch(() => { if (active) setInviteCode('------'); });
    return () => { active = false; };
  }, [phone, rewards.inviteActive]);
  useEffect(() => {
    if (page === 'rewards' && !enabled(rewards.active)) navigate('home');
    if (page === 'shipping' && !enabled(areaSettings.shippingEnabled)) navigate('home');
    if (page === 'market' && !enabled(areaSettings.market)) navigate('home');
  }, [page, rewards.active, areaSettings.shippingEnabled, areaSettings.market, navigate]);
  useEffect(() => { setService(null); setProfileSheet(null); setSuccess(null); setConfirmation(null); }, [phone]);
  useEffect(() => { setService(null); }, [area]);

  function canOrder() {
    if (!phone) { toast('لازم تتقبل الطلب الأول', 'info'); return false; }
    if (suspended) { toast('⏸️ حسابك معلق — مش هتقدر تعمل طلب', 'error'); return false; }
    if (!online) { toast('اتصل بالإنترنت لإتمام الطلب', 'error'); return false; }
    if (closed) { toast('إحنا بره ساعات العمل دلوقتي', 'error'); return false; }
    if (auth.verificationRequired) { toast('محتاج تأكيد رقم واتساب الأول', 'error'); return false; }
    if (auth.sessionLoading || settingsSource.loading || rewardSource.loading || pricingSource.loading || workHoursSource.loading) { toast('جاري تحميل بيانات الحساب، حاول بعد لحظة', 'info'); return false; }
    if (auth.sessionError || settingsSource.error || pricingSource.error || rewardSource.error || workHoursSource.error) { toast('تعذر التحقق من الحساب، حاول تاني', 'error'); return false; }
    return true;
  }
  function openService(next) {
    if (!canOrder()) return;
    const keys = { mishwar: 'tuktuk', pharma: 'pharmacy', vegetables: 'vegetables', market: 'market', custom: 'customRequest', shipping: 'package' };
    if (typeof next === 'string' && (!enabled(areaSettings[keys[next]]) || (next === 'shipping' && !enabled(areaSettings.shippingEnabled)))) { toast('الخدمة غير متاحة حالياً', 'error'); return; }
    if (next === 'market') navigate('market'); else setService(next);
  }
  async function submitOrder(data, kind = 'delivery') {
    if (operation.current || !canOrder()) return false;
    const submittingSession = session.current;
    const keys = { trip: 'tuktuk', pharma: 'pharmacy', grocery: 'vegetables', market: 'market', shipping: 'package' };
    if (!enabled(areaSettings[keys[data.orderType]]) || data.isShipping && !enabled(areaSettings.shippingEnabled)) { toast('الخدمة غير متاحة حالياً', 'error'); return false; }
    operation.current = true;
    try {
      const order = await orderMutation.mutateAsync({ data, customer: user, settings: rewards, discounts, kind, challenge: challengeSource.value });
      if (kind === 'delivery' && discounts.coupon) setDiscounts({ ...discounts, coupon: false, couponCost: 0 });
      if (kind === 'trip' && discounts.amount) setDiscounts({ ...discounts, amount: 0, amountCost: 0 });
      if (session.current !== submittingSession) return true;
      setService(null); setCelebration((value) => value + 1);
      setSuccess({ message: data.isShipping ? '✅ تم إنشاء شحنتك!' : order.pointsEarned ? `تم إرسال طلبك، وكسبت ${order.pointsEarned} نقطة! 🎁` : 'تم إرسال طلبك', trackingCode: data.trackingCode });
      navigate(data.isShipping ? 'shipping' : 'orders');
      rewardInvite(phone, rewards).catch(() => {});
      return true;
    } catch (error) { console.error('Order failed', error); toast('تعذر إرسال الطلب، حاول تاني', 'error'); return false; }
    finally { operation.current = false; }
  }
  async function redeem(type) {
    if (!canOrder() || !enabled(rewards.active)) return;
    const isDelivery = type === 'delivery';
    if (isDelivery ? discounts.coupon : discounts.amount > 0) { toast('عندك خصم نشط بالفعل', 'info'); return; }
    const cost = Number(isDelivery ? rewards.discountCost : rewards.tripDiscountCost);
    confirm(isDelivery ? 'توصيل مجاني 🛵' : 'خصم مالي 🏷️', `خصم ${cost} نقطة`, async () => {
      if (!canOrder()) return;
      const after = await deductPoints(phone, cost);
      setDiscounts(isDelivery ? { ...discounts, coupon: true, couponCost: cost } : { ...discounts, amount: Number(rewards.directDiscountValue), amountCost: cost });
      create(`rewards_history/${phone}`, { type: isDelivery ? 'delivery' : 'discount', typeName: isDelivery ? 'توصيل مجاني' : 'خصم مالي', cost, pointsBefore: after + cost, pointsAfter: after, usedAt: Date.now() }).catch(() => {});
      setCelebration((value) => value + 1); toast('✅ تم التفعيل!', 'success'); navigate('home');
    });
  }
  async function removeDiscount(type) {
    if (operation.current || !canOrder()) return;
    operation.current = true;
    try {
      const cost = type === 'delivery' ? discounts.couponCost : discounts.amountCost;
      if (cost > 0) await transaction(`users_points/${phone}`, (value) => Number(value || 0) + cost);
      setDiscounts(type === 'delivery' ? { ...discounts, coupon: false, couponCost: 0 } : { ...discounts, amount: 0, amountCost: 0 });
    } catch { toast('فشل إلغاء الخصم، حاول تاني', 'error'); }
    finally { operation.current = false; }
  }
  function cancelOrder(id) {
    confirm('إلغاء الطلب', 'متأكد من إلغاء الطلب؟', async () => {
      if (!canOrder()) return;
      await cancellationMutation.mutateAsync({ id, phone }); toast('✅ تم إلغاء الطلب', 'success');
    });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('✅ الكود اتنسخ!', 'success'); }
    catch { toast('تعذر النسخ، اضغط مطولاً على الكود لنسخه', 'info'); }
  }
  const social = socialSource.value;
  const support = supportSource.value || '01115699940';
  const socialLinks = [
    enabled(social.whatsappEnabled) && { key: 'whatsapp', icon: 'fa-whatsapp', label: 'واتساب', href: whatsappUrl(social.whatsappNumber || support, 'السلام عليكم 🙏') },
    enabled(social.facebookEnabled) && safeUrl(social.facebookUrl) && { key: 'facebook', icon: 'fa-facebook-f', label: 'فيسبوك', href: safeUrl(social.facebookUrl) },
  ].filter(Boolean);
  const value = { ...auth, online, page, navigate, service, openService, closeService: () => setService(null), profileSheet, setProfileSheet, notice, toast, confirmation, confirm, closeConfirm: () => setConfirmation(null), success, closeSuccess: () => setSuccess(null), celebration, notification, closeNotification: () => setNotification(null),
    areas: Object.values(areasSource.value).filter((item) => typeof item === 'string' || item?.name && enabled(item.active)).map((item) => typeof item === 'string' ? item : item.name), areasLoading: areasSource.loading, areasError: areasSource.error,
    rewards, rewardsLoading: rewardSource.loading, areaSettings, pricing, pricingLoading: pricingSource.loading, points: Number(pointsSource.value) || 0, pointsLoading: pointsSource.loading, discounts, redeem, removeDiscount,
    orders: entries(ordersSource.value).filter((item) => item.phone === phone || item.customerPhone === phone), ordersLoading: ordersSource.loading, ordersError: ordersSource.error, cancelOrder,
    customServices: ordered(entries(servicesSource.value).filter((item) => enabled(item.active))), shops: ordered(entries(shopsSource.value).filter((item) => item.name && safeUrl(item.link))),
    challenge: challengeSource.value, inviteCode, socialLinks, support, supportUrl: whatsappUrl(support), workHours: workHoursSource.value, closed, canOrder, submitOrder, copy,
    claimCard: (network) => claimCard(phone, area, network, Number(rewards.fakkaCost)),
    celebrate: () => setCelebration((current) => current + 1),
    logout: () => confirm('تسجيل الخروج', 'هتخرج؟', () => { auth.logoutNow(); navigate('home'); }),
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useApp() { return useContext(AppContext); }
