import { z } from 'zod';

export const phoneSchema = z.string().trim().regex(/^01\d{9}$/, 'رقم الموبايل لازم 11 رقم ويبدأ بـ 01');
export const LOCAL_TEST_OTP_ENABLED = import.meta.env?.DEV === true && import.meta.env?.VITE_LOCAL_TEST_OTP === 'true';
export const VERIFICATION_CODE_LENGTH = LOCAL_TEST_OTP_ENABLED ? 4 : 6;
export const verificationCodeSchema = z.string().trim().regex(new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`), `اكتب كود التحقق المكوّن من ${VERIFICATION_CODE_LENGTH} أرقام`);
export const sendCodeSchema = z.object({ phone: phoneSchema });
export const verifyCodeSchema = z.object({ challengeId: z.string().min(1, 'اطلب كود جديد'), code: verificationCodeSchema });
export const registrationSchema = z.object({
  name: z.string().trim().min(1, 'اكتب اسمك').max(80, 'الاسم طويل جداً'),
  phone: phoneSchema,
  area: z.string().trim().min(1, 'اختر منطقتك').max(120),
  inviteCode: z.string().trim().max(32, 'كود الدعوة طويل جداً').transform((value) => value.toUpperCase()).default(''),
});
const address = z.string().trim().min(3, 'اكتب العنوان بالتفصيل').max(500, 'العنوان طويل جداً');
const details = z.string().trim().min(1, 'اكتب تفاصيل الطلب').max(8000, 'تفاصيل الطلب طويلة جداً');
export function serviceFormSchema(kind) {
  const fields = { address };
  if (kind === 'mishwar') fields.destinationId = z.string().min(1, 'اختر الوجهة أول');
  if (['pharma', 'vegetables', 'shipping'].includes(kind)) fields.details = details;
  if (['custom', 'custom-service'].includes(kind)) fields.item = z.string().trim().min(1, 'اكتب اسم الحاجة').max(500);
  if (kind === 'shipping') Object.assign(fields, {
    fromName: z.string().trim().min(1, 'اكتب اسم المرسل').max(80), fromPhone: phoneSchema,
    toName: z.string().trim().min(1, 'اكتب اسم المستلم').max(80), toPhone: phoneSchema,
    toAddress: address,
    cod: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite('اكتب مبلغ تحصيل صحيح').min(0, 'المبلغ لا يمكن يكون سالب').max(1000000, 'مبلغ التحصيل كبير جداً')),
  });
  return z.object(fields);
}
export const shippingSenderFields = [
  { name: 'fromName', id: 'ship-from-name', label: 'اسم المرسل', icon: 'fa-user', autoComplete: 'name' },
  { name: 'fromPhone', id: 'ship-from-phone', label: 'رقم المرسل', icon: 'fa-phone', type: 'tel', maxLength: 11 },
];
export const shippingReceiverFields = [
  { name: 'toName', id: 'ship-to-name', label: 'اسم المستلم', icon: 'fa-user-tag' },
  { name: 'toPhone', id: 'ship-to-phone', label: 'رقم المستلم', icon: 'fa-phone', type: 'tel', maxLength: 11 },
  { name: 'toAddress', id: 'ship-to-address', label: 'عنوان التسليم', icon: 'fa-map-marker-alt' },
  { name: 'details', id: 'ship-contents', label: 'محتويات الشحنة', icon: 'fa-list', type: 'textarea', rows: 2 },
  { name: 'cod', id: 'ship-cod', label: 'COD (اختياري)', icon: 'fa-money-bill-wave', type: 'number', min: 0, step: 'any' },
];
