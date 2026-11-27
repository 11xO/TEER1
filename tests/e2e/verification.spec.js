import { expect, test } from '@playwright/test';
import { area, phone, setup, user } from './fixture.js';

test('WhatsApp multi-step validation, wrong code, cooldown, and registration retry after verified OTP', async ({ page }) => {
  let authenticated = false;
  let checks = 0;
  let sends = 0;
  const apiHandler = async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { verified: true, phone, expiresAt: Date.now() + 86400000 } : { error: { code: 'UNAUTHENTICATED' } } });
    if (url.pathname === '/api/whatsapp/send') { sends++; return route.fulfill({ json: { challengeId: '12345678-1234-4234-9234-123456789012', phone, expiresAt: Date.now() + 600000, resendAt: Date.now() + 60000 } }); }
    if (url.pathname === '/api/whatsapp/verify') {
      checks++;
      const { code } = route.request().postDataJSON();
      if (code !== '123456') return route.fulfill({ status: 400, json: { error: { code: 'INVALID_CODE', message: 'Incorrect code' } } });
      authenticated = true;
      return route.fulfill({ json: { verified: true, phone, expiresAt: Date.now() + 86400000 } });
    }
    return route.abort();
  };
  await setup(page, { loggedIn: false, url: 'http://127.0.0.1:5175/', apiHandler });
  await page.getByRole('button', { name: 'إرسال كود التحقق على واتساب' }).click();
  await expect(page.getByText('اكتب اسمك', { exact: true })).toBeVisible();
  expect(sends).toBe(0);
  await page.getByLabel('اسمك الكامل').fill(user.name);
  await page.getByLabel('رقم موبايلك', { exact: true }).fill(phone);
  await page.getByRole('button', { name: '📍 اختر منطقتك...' }).click();
  await page.getByRole('button', { name: area }).click();
  await page.getByRole('button', { name: 'إرسال كود التحقق على واتساب' }).click();
  await expect(page.getByLabel('رقم 1 من 6 لكود التحقق')).toBeVisible();
  await expect(page.getByRole('button', { name: /إعادة إرسال الكود بعد \d{2}:\d{2}/ })).toBeDisabled();
  for (let digit = 1; digit <= 6; digit++) await page.getByLabel(`رقم ${digit} من 6 لكود التحقق`).fill('0');
  await page.getByRole('button', { name: 'تأكيد الكود والمتابعة' }).click();
  await expect(page.getByText('كود التحقق غير صحيح.')).toBeVisible();
  for (let digit = 1; digit <= 6; digit++) await page.getByLabel(`رقم ${digit} من 6 لكود التحقق`).fill('123456'[digit - 1]);
  await page.getByRole('button', { name: 'تأكيد الكود والمتابعة' }).click();
  await expect(page.locator('#appSection')).toBeVisible();
  await expect(page.getByText(user.name, { exact: true })).toBeVisible();
  expect(checks).toBe(2); expect(sends).toBe(1);
});

test('a restored local profile cannot reveal protected UI without a verified server session', async ({ page }) => {
  await setup(page, { url: 'http://127.0.0.1:5175/', apiHandler: (route) => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }) });
  await expect(page.getByRole('button', { name: 'إرسال كود التحقق', exact: true })).toBeVisible();
  await expect(page.locator('#appSection')).toHaveCount(0);
});

test('orders search, status filter, and pagination work with live data', async ({ page }) => {
  await setup(page);
  await page.evaluate(async ({ phone }) => {
    const orders = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [String(index), { phone, type: index === 20 ? 'صيدلية مميزة' : 'مشوار', status: index % 2 ? 'active' : 'ready_for_driver', price: 20, time: Date.now() - index }]));
    await window.__fixture.write('orders', orders);
  }, { phone });
  await page.getByRole('button', { name: 'طلباتي', exact: true }).click();
  await expect(page.locator('.order-item')).toHaveCount(10);
  await page.getByRole('button', { name: 'التالي', exact: true }).click();
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible();
  await page.getByLabel('تصفية حسب الحالة').selectOption('active');
  await expect(page.locator('.order-item')).toHaveCount(10);
  await expect(page.locator('.pagination')).toHaveCount(0);
  await page.getByLabel('تصفية حسب الحالة').selectOption('all');
  await page.getByLabel('البحث في الطلبات').fill('صيدلية مميزة');
  await expect(page.locator('.order-item')).toHaveCount(1);
});
