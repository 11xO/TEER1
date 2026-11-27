# طبقة API والتحقق من واتساب

نسخة الخادم المتوافقة مع Cloudflare Workers داخل [hosted](./hosted)، وتستخدم D1 للجلسات والتحديات. نسخة Node.js وSQLite ما زالت متاحة محليًا. لبناء نسخة Workers شغّل `npm run db:generate` عند تغيير مخطط البيانات، ثم `npm run build:hosted` و`npm run test:hosted`. يحتاج نشرها ربط D1 باسم `DB`، وتطبيق ترحيلات [drizzle](../drizzle)، وضبط `APP_ORIGIN` ومفاتيح Twilio كأسرار في الاستضافة. بناء المشروع وحده لا ينشر الخادم.

الخادم داخل هذا المجلد، وعميل React داخل [src/api](../src/api). ملف إرسال وفحص الكود الحقيقي هو [whatsappVerification.js](./whatsappVerification.js)، وملف استدعائه من الواجهة هو [src/api/whatsappVerification.js](../src/api/whatsappVerification.js).

## تشغيل التحقق الحقيقي

1. استخدم Node.js إصدار 22.13 أو أحدث؛ يُفضّل Node.js 24.
2. انسخ [.env.example](./.env.example) إلى ملف `api/.env`، وأدخل `TWILIO_ACCOUNT_SID` و`TWILIO_AUTH_TOKEN` و`TWILIO_VERIFY_SERVICE_SID` من حسابك. فعّل WhatsApp في Twilio Verify واضبط طول الكود على 6 أرقام. راجع [توثيق إنشاء التحقق](https://www.twilio.com/docs/verify/api/verification) و[فحص الكود](https://www.twilio.com/docs/verify/api/verification-check).
3. انسخ [.env.example الخاص بالواجهة](../.env.example) إلى `.env.local` واضبط:

```dotenv
VITE_WHATSAPP_VERIFICATION_ENABLED=true
VITE_API_BASE_URL=/api
```

4. شغّل الخادم والواجهة في نافذتين:

```sh
npm run api
```

```sh
npm run dev
```

استخدم المنفذ 5173 أو عدّل `APP_ORIGIN` لعنوان الواجهة الفعلي. يمرر Vite طلبات `/api` واتصال WebSocket إلى الخادم على المنفذ 3001. يحتاج Vite إعادة تشغيل عند تعديل متغيراته.

التفعيل الافتراضي للواجهة `false` للحفاظ على تدفق التسجيل الحالي لحين إعداد المزوّد. الخادم بدون المفاتيح يعيد `503 WHATSAPP_NOT_CONFIGURED` افتراضيًا. للاختبار المحلي فقط، يمكن تفعيل `DEV_OTP_ENABLED=true` مع `NODE_ENV=development` وربط API وواجهة التطبيق بـ loopback؛ عندها يقبل الخادم الكود `5060` ولا يرسل رسالة. هذا الوضع يرفض أي عنوان استضافة غير محلي ولا يعمل في الإنتاج. استخدم Twilio Verify للإرسال الحقيقي؛ لم تُرسل رسائل حقيقية أثناء الاختبارات.

## المسارات

| المسار | الوظيفة |
| --- | --- |
| `POST /api/whatsapp/send` | يستقبل `{phone}` ويرسل كود WhatsApp؛ يعيد `{challengeId, phone, expiresAt, resendAt}`. |
| `POST /api/whatsapp/verify` | يستقبل `{challengeId, code}` ويؤكد الكود المرتبط بنفس المتصفح؛ ينشئ Cookie للجلسة عند النجاح. |
| `GET /api/session` | الجلسة المؤكدة، أو `401` عند غيابها أو انتهاء صلاحيتها. |
| `DELETE /api/session` | ينهي الجلسة في الخادم ويمسح Cookie. |
| `WS /api/events` | اتصال محمي بالجلسة وOrigin؛ يرسل تحديث الجلسة وانتهاءها مع heartbeat. |

الأرقام المصرية مقبولة محليًا بصيغة `01xxxxxxxxx`، ويحوّلها الخادم إلى E.164 للإرسال. لا تُعد موافقة الإدارة نتيجة تلقائية للتحقق من الرقم؛ التحقق من الملكية ومراجعة التسجيل خطوتان منفصلتان.

## تنظيم المتطلبات

| المتطلب | التنفيذ |
| --- | --- |
| React Hook Form وZod | [schemas](../src/api/schemas.js)، [عناصر النماذج](../src/api/forms.jsx)، التسجيل ونماذج الخدمات. |
| Dynamic Forms | وصف حقول المرسل والمستلم وظهورها حسب الخدمة، مع Schema مناسبة لكل نوع. |
| Multi-Step Forms | عند تفعيل التحقق الحقيقي: بيانات التسجيل ← كود واتساب ← دخول مباشر بعد تأكيد الرقم؛ وعند تعطيله يبقى تدفق التسجيل وموافقة الإدارة القديم. |
| REST وRequest Cancellation | [http](../src/api/http.js): JSON وCookies وAbortController ومهلة الاتصال؛ إلغاء تحقق معلّق عند مغادرة النموذج. |
| Loading / Error / Empty | حالات التحميل والخطأ والفراغ ورسائل الحقول، مع تعطيل الإرسال المتكرر. |
| Pagination / Filtering / Search | [collection](../src/api/collection.js) وصفحة الطلبات؛ التصفية والبحث يسبقان تقسيم النتائج إلى صفحات. التقسيم في العميل لأن مصدر الطلبات الحالي Firebase. |
| Authentication / Protected UI | جلسة خادم HttpOnly، و[ProtectedUI](../src/features/auth/ProtectedUI.jsx) يمنع دخول الحساب المحلي غير المؤكد عند تفعيل الميزة. |
| TanStack Query | [queryClient](../src/api/queryClient.js)، Session query، Mutations للتحقق والتسجيل وإنشاء وإلغاء الطلبات؛ لا إعادة تلقائية لعمليات الكتابة. |
| Real-Time / WebSockets | [events](./events.js) و[عميل WebSocket](../src/api/realtime.js) للجلسات، و[Firebase](../src/api/firebase.js) لتحديث الطلبات والإعدادات مباشرة مع تنظيف الاشتراكات. |

## الجلسات والتخزين والنشر

Twilio يدير الكود؛ لا يُحفظ الكود في المتصفح أو قاعدة التطبيق ولا يُعاد في استجابة API. يحتفظ الخادم بتحديات قصيرة الصلاحية وربط بالمتصفح، وحد محاولات، وفترة انتظار بين الرسائل، وحد طلبات حسب عنوان الاتصال. الجلسة رمز عشوائي محفوظ Hash في SQLite، وCookie من نوع HttpOnly وSameSite=Lax. صلاحية التحدي 10 دقائق والجلسة 7 أيام، مع إبطال فعلي في الخادم عند الخروج. إعادة الإرسال لنفس Twilio Verification SID لا تصفّر المحاولات أو تمد الصلاحية.

ملف SQLite الافتراضي `api/.data/auth.sqlite` غير مضاف للتحكم في الإصدارات. ضع `API_STORE_PATH` على قرص دائم عند النشر. هذا التنفيذ مناسب لعملية API واحدة؛ التشغيل على عدة نسخ يحتاج مخزن جلسات وتحديد طلبات مشتركًا. حافظ على قرص SQLite عند إعادة التشغيل، ولا تستخدم مجلدًا مؤقتًا في الإنتاج.

في الإنتاج اضبط `NODE_ENV=production` و`APP_ORIGIN=https://your-domain`، وابنِ الواجهة بأمر `npm run build`. يستطيع الخادم تقديم [dist](../dist) مباشرة، أو استخدم reverse proxy يمرر `/api` وWebSocket بنفس Origin ويحافظ على ترويسة Origin. Cookies تكون Secure في الإنتاج. عند وجود proxy موثوق، اضبط trusted proxy بعناوين محددة إن احتجت تحديد المعدل حسب المستخدم؛ الإعداد الحالي لا يثق بـ `X-Forwarded-For` المرسل عشوائيًا.

هذه الجلسة تحمي مسارات الخادم وواجهة التحقق؛ صلاحيات الوصول إلى Firebase مباشرة تظل مسؤولية Firebase Authentication وSecurity Rules. نقل قواعد الأعمال إلى API موثقة بجلسة أو اعتماد Firebase Custom Auth يحتاج إعداد المشروع وصلاحياته، ولا يتحقق بإخفاء الواجهة وحده. أسرار Twilio لا تدخل مطلقًا في متغيرات `VITE_` أو حزمة المتصفح. Service Worker لا يخزّن جلسات أو استجابات API.

## الاختبارات

```sh
npm test
npm run lint
npm run build
npm run test:e2e
```

اختبارات الخادم تستخدم مزوّدًا محقونًا وSQLite معزولة، وتغطي الكود الغلط والمنتهي وإعادة الاستخدام والتوازي والتخزين والخروج وWebSocket. اختبارات المتصفح تختبر التدفق القديم وتدفق OTP والبحث والتقسيم، دون الاتصال بمزوّد واتساب أو قاعدة Firebase الحقيقية.
