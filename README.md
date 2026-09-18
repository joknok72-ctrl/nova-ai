# ⚡ NOVA CODE — مبرمجك الخارق بالذكاء الاصطناعي

> مهندس برمجيات بالذكاء الاصطناعي يبني مشاريع كاملة من الصفر، يصلح الأخطاء، يراجع الكود، ويصمّم الأنظمة — مع ذاكرة طويلة المدى وردود لحظية. مخصص 100% للبرمجة والبناء.

## 🎯 نظرة عامة
- **الاسم**: NOVA CODE
- **الهدف**: منصة AI متخصصة في البرمجة فقط — تكتب مشاريع كاملة قابلة للتشغيل (كل الملفات + أوامر التشغيل والنشر) حتى لمن لا يعرف البرمجة.
- **المميزات**:
  - 🏗️ **6 أوضاع هندسية**: البنّاء (مشاريع كاملة)، المُصحِّح، المُراجِع، المهندس المعماري، المُعلِّم، DevOps
  - 📦 **بدون placeholders** — System Prompts مُحكمة تُلزم النموذج بكتابة ملفات كاملة قابلة للتشغيل
  - 🔄 **Streaming (SSE)** — الكود يظهر لحظياً مع إيقاف / إعادة توليد / تعديل
  - 🧠 **ذاكرة طويلة المدى** — يتذكر الـ stack ونظام التشغيل والمشاريع ومستواك تلقائياً
  - 🚀 **4 نماذج**: NOVA Codex (الأقوى في الكود) / Ultra / Pro / Fast
  - 🔑 **BYOK** — ضع مفتاح API الخاص بك من أي مزود متوافق مع OpenAI (يُحفظ في متصفحك فقط)
  - 🎨 تلوين الكود + نسخ بضغطة + تصدير المحادثة Markdown
  - 💬 عناوين تلقائية، بحث، تثبيت، إعادة تسمية، حذف
  - 🌍 عربي/إنجليزي تلقائياً، واجهة RTL، متجاوبة للموبايل
  - 🔒 بدون تسجيل (هوية عبر Cookie آمن HttpOnly)

## 🔗 الروابط
- **تجريبي (Sandbox)**: https://3000-ivmia8352umz5zm228vmx-ecea8f22.sandbox.novita.ai
- **GitHub**: https://github.com/joknok72-ctrl/nova-ai
- **Production**: لم يُنشر بعد

## 🛠️ الـ Stack
| الطبقة | التقنية |
|---|---|
| Backend | Hono + TypeScript على Cloudflare Workers/Pages |
| Database | Cloudflare D1 (SQLite) |
| LLM | أي API متوافق مع OpenAI (Streaming) |
| Frontend | Vanilla JS + Tailwind + marked + highlight.js + DOMPurify |
| Build | Vite |

## 🗄️ البيانات
```
conversations (id, user_id, title, persona, model, pinned, created_at, updated_at)
messages      (id, conversation_id, role, content, tokens, created_at)
memories      (id, user_id, fact, source_conversation_id, created_at)
usage_stats   (user_id, total_messages, total_tokens, last_active)
```
**التدفق**: رسالة → D1 → بناء Context (System Prompt للوضع + الذاكرة + آخر الرسائل ≤ 24K توكن) → LLM Streaming → حفظ الرد → بالخلفية: عنوان تلقائي + استخلاص حقائق للذاكرة. عند فشل المزود يُحذف تلقائياً ما لم يكتمل (Rollback).

## 🧩 API
| Method | Path | الوصف |
|---|---|---|
| GET | `/api/meta` | الأوضاع، النماذج، الإحصائيات، حالة مفتاح الخادم |
| GET/POST | `/api/conversations` | قائمة / إنشاء `{persona, model}` |
| GET/PATCH/DELETE | `/api/conversations/:id` | جلب مع الرسائل / تعديل `{title, persona, model, pinned}` / حذف |
| POST | `/api/chat` | **SSE** `{content, conversation_id?, persona?, model?, regenerate?}` → أحداث `meta`, `delta`, `error`, `done` |
| GET/POST/DELETE | `/api/memories[/:id]` | إدارة الذاكرة |

BYOK headers على `/api/chat`: `x-nova-key`, `x-nova-base-url`, `x-nova-cheap-model`

## 📖 طريقة الاستخدام
1. افتح الرابط. اختر **الوضع** (البنّاء افتراضياً) و**النموذج**.
2. اكتب مثلاً: «ابني لي بوت تليجرام بـ Python يحفظ المستخدمين» → ستحصل على كل الملفات + خطوات تشغيل للمبتدئين.
3. لو المشروع كبير وتوقف الرد، اكتب **«كمّل»**.
4. للأخطاء: بدّل لوضع **المُصحِّح** والصق الكود + رسالة الخطأ.
5. **لو ظهر خطأ رصيد/مفتاح**: ⚙️ الإعدادات → ضع مفتاح API خاص بك.

## 🚀 التشغيل محلياً
```bash
npm install
cp .dev.vars.example .dev.vars    # ضع مفتاحك
npm run build
npx wrangler d1 migrations apply webapp-production --local
pm2 start ecosystem.config.cjs    # http://localhost:3000
```

## ☁️ النشر على Cloudflare Pages
```bash
npx wrangler d1 create webapp-production          # انسخ database_id إلى wrangler.jsonc
npx wrangler d1 migrations apply webapp-production
npx wrangler pages project create nova-ai --production-branch main
npm run build && npx wrangler pages deploy dist --project-name nova-ai
npx wrangler pages secret put OPENAI_API_KEY --project-name nova-ai
npx wrangler pages secret put OPENAI_BASE_URL --project-name nova-ai
```
**الحالة**: ⏳ جاهز للنشر

## 🔜 خطوات مقترحة
- [ ] معاينة حية للـ HTML/React داخل المتصفح (Sandbox iframe)
- [ ] تنزيل المشروع كـ ZIP بضغطة واحدة
- [ ] رفع ملفات/صور (Vision) عبر R2 لتحويل التصميم إلى كود
- [ ] تسجيل دخول لمزامنة المحادثات بين الأجهزة
- [ ] ربط مباشر بـ GitHub (Push المشروع من الشات)
- [ ] Rate limiting

**آخر تحديث**: 2026-09-18
