import { test, expect } from '@playwright/test';
import { setup, user, area, phone, fixtureData } from './fixture.js';

test('rewards show previously used fakka cards in history', async ({ page }) => {
  const data = fixtureData();
  data.primary.rewards_history = { [phone]: {
    card1: { type: 'fakka', typeName: 'كارت فكة فودافون', network: 'فودافون', cardCode: '12345678912345', cost: 150, usedAt: 1763774400000 },
    discount1: { type: 'delivery', typeName: 'توصيل مجاني', cost: 100, usedAt: 1763774400000 },
  } };
  await setup(page, { data, url: '/#rewards' });
  await page.getByRole('button', { name: 'سجل الكروت' }).click();
  await expect(page.getByText('12345678912345')).toBeVisible();
  await expect(page.getByText('كارت فكة فودافون', { exact: true })).toBeVisible();
  await expect(page.getByText('150 نقطة')).toBeVisible();
  await expect(page.getByText('توصيل مجاني')).toHaveCount(0);
});

test('mobile layout, full-discount trip, failed-write retry, and coupon consumption', async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await setup(page, { discounts: { coupon: false, amount: 20, amountCost: 50 } });
  await expect(page.getByText(user.name, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-home.png') });
  await page.getByRole('button', { name: 'توك توك مشوار' }).click();
  await page.getByRole('button', { name: 'اختر الوجهة...' }).click();
  await page.getByRole('button', { name: '📍 المحطة 0 ج' }).click();
  await page.evaluate(() => { window.__failOrder = true; });
  await page.getByRole('button', { name: 'اطلب الآن' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() =>   JSON.parse(localStorage.getItem('teer_discounts:01111111111')).amount)).toBe(20);
  await page.evaluate(() => { window.__failOrder = false; });
  await page.getByRole('button', { name: 'اطلب الآن' }).click();
  await expect(page.locator('#successSheet')).toBeVisible();
  const orders = await page.evaluate(() => Object.values(window.__fixture.data.primary.orders));
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ price: 0, originalPrice: 15, discountAmount: 15, orderType: 'trip' });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('teer_discounts:01111111111')).amount)).toBe(0);
  expect(errors).toEqual([]);
});

test('market cart keeps address while quantities change and applies delivery coupon only', async ({ page }) => {
  await setup(page, { discounts: { coupon: true, couponCost: 100, amount: 20, amountCost: 50 } });
  await page.getByRole('button', { name: 'ماركت', exact: true }).click();
  await page.getByRole('button', { name: 'إضافة أرز' }).click();
  await page.getByRole('button', { name: 'سلة المشتريات', exact: true }).click();
  await page.getByRole('button', { name: 'مكان آخر' }).click();
  await page.getByLabel('عنوان التوصيل').fill('شارع جديد ١٢');
  await page.getByRole('button', { name: 'زيادة الكمية' }).click();
  await expect(page.getByLabel('عنوان التوصيل')).toHaveValue('شارع جديد ١٢');
  await page.getByRole('button', { name: 'إتمام (100 ج)' }).click();
  await expect(page.locator('#successSheet')).toBeVisible();
  const orders = await page.evaluate(() => Object.values(window.__fixture.data.primary.orders));
  expect(orders[0]).toMatchObject({ price: 100, originalPrice: 125, discountAmount: 25, itemsTotal: 100, to: 'شارع جديد ١٢' });
  expect(orders[0].items[0]).toMatchObject({ name: 'أرز', price: 50, qty: 2 });
  const discounts = await page.evaluate(() => JSON.parse(localStorage.getItem('teer_discounts:01111111111')));
  expect(discounts.coupon).toBe(false); expect(discounts.amount).toBe(20);
});

test('shipping and current orders update independently, active orders cannot be cancelled twice', async ({ page }) => {
  await setup(page);
  await page.evaluate(async ({ phone }) => {
    await window.__fixture.write('orders/a', { phone, type: 'مشوار', orderType: 'trip', status: 'ready_for_driver', time: Date.now(), price: 15, pointsEarned: 10 });
    await window.__fixture.write('orders/b', { phone, type: 'شحنة', isShipping: true, status: 'ready_for_driver', shipStatus: 'pending', trackingCode: 'TEER-TEST', time: Date.now() });
  }, { phone });
  await page.getByRole('button', { name: 'الشحن', exact: true }).click();
  await expect(page.getByText('TEER-TEST')).toBeVisible();
  await page.getByRole('button', { name: 'طلباتي', exact: true }).click();
  await page.getByRole('button', { name: 'إلغاء الطلب' }).click();
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(page.locator('#confirmSheet')).toHaveCount(0);
  await expect(page.getByText('لا توجد طلبات حالية')).toBeVisible();
  await page.getByRole('button', { name: 'السجل' }).click();
  await expect(page.locator('.order-status-badge').filter({ hasText: 'ملغي' })).toBeVisible();
  expect(await page.evaluate(({ phone }) => window.__fixture.data.primary.users_points[phone], { phone })).toBe(490);
});

test('address editor flushes changes before closing and resubscribes after area change', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'تعديل العنوان', exact: true }).click();
  await page.getByLabel('العنوان بالتفصيل', { exact: false }).fill('عنوان جديد في شارع النور');
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await expect(page.locator('#addressSheet')).toHaveCount(0);
  expect(await page.evaluate(({ phone }) => window.__fixture.data.secondary.customers[phone].address, { phone })).toBe('عنوان جديد في شارع النور');
  await page.getByRole('button', { name: 'الإعدادات' }).click();
  await page.getByRole('button', { name: /تغيير المنطقة/ }).click();
  await page.getByRole('button', { name: 'المنطقة الثانية' }).click();
  await expect(page.locator('#areaSheet')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('user_area'))).toBe('المنطقة الثانية');
});

test('registration waiting preview cannot submit and approval signs in live', async ({ page }, info) => {
  await setup(page, { loggedIn: false });
  await page.screenshot({ path: info.outputPath('mobile-login.png') });
  await page.getByLabel('اسمك الكامل').fill(user.name);
  await page.getByLabel('رقم موبايلك', { exact: true }).fill(phone);
  await page.getByRole('button', { name: '📍 اختر منطقتك...' }).click();
  await page.getByRole('button', { name: area }).click();
  await page.getByRole('button', { name: 'أرسل على واتساب للتسجيل' }).click();
  await expect(page.getByText('⏳ جاري المراجعة')).toBeVisible();
  await page.getByRole('button', { name: 'شوف التطبيق (معاينة فقط)' }).click();
  await page.getByRole('button', { name: 'توك توك مشوار' }).click();
  await expect(page.locator('#serviceSheet')).toHaveCount(0);
  await page.evaluate(async () => { const id = Object.keys(window.__fixture.data.primary.pending_registrations)[0]; await window.__fixture.patch('pending_registrations/' + id, { status: 'approved' }); });
  await expect(page.getByText(user.name, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('user_phone'))).toBe(phone);
});

test('production PWA caches bundled fonts, icons, and shell for offline restart', async ({ page, context }) => {
  await page.route('**/*', (route) => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('http://localhost:4174/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; await document.fonts.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  expect(manifest).toMatchObject({ display: 'standalone', lang: 'ar', dir: 'rtl' });
  for (const icon of manifest.icons) expect((await page.request.get('http://localhost:4174/' + icon.src.replace('./', ''))).ok()).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('اسمك الكامل')).toBeVisible();
  await expect(page.locator('.offline-banner')).toHaveClass(/show/);
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('900 26px Cairo'); })).toBe(true);
  await context.setOffline(false);
});
