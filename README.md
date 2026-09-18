# ⚡ NOVA CODE — مبرمجك الخارق بالذكاء الاصطناعي

> أنت تقول **ماذا** تريد، وهو يقرر **كل شيء تقني** ويبنيه كاملاً. يعمل **بدون إنترنت** — الشبكة تُستخدم فقط لإرسال رسالتك للنموذج (بضع كيلوبايت).

## 🔗 الروابط
- **الموقع (Production)**: https://nova-code-9u9.pages.dev
- **GitHub**: https://github.com/joknok72-ctrl/nova-ai
- **Cloudflare Pages project**: `nova-code` (حساب `eaf25271…`)

## 🎯 ما هو
منصة ذكاء اصطناعي مخصصة **للبرمجة والبناء فقط**. مصممة لمن لا يعرف البرمجة: لا تختار لغة ولا إطار عمل — NOVA يختار الأفضل ويكتب المشروع كاملاً بكل ملفاته، ويشرح خطوة بخطوة كيف تشغّله وتنشره.

## ✨ المميزات
| | |
|---|---|
| ⚡ **وضع تلقائي ذكي** | يحدد بنفسه: بناء / إصلاح / مراجعة / تصميم معماري / شرح / نشر — بدون أوضاع يختارها المستخدم |
| 📦 **مشاريع كاملة** | كل الملفات قابلة للتشغيل، ممنوع placeholders، مع خطوات للمبتدئين حسب نظام تشغيلك |
| 🗂️ **مستعرض ملفات** | يستخرج الملفات من الرد تلقائياً · **معاينة حية** للمواقع · **تنزيل ZIP** |
| 🔁 **إكمال تلقائي** | لو قطع النموذج الرد لطوله، يكمل من نفسه حتى 4 مرات |
| 📎 **إرفاق ملفات كود** | أو الصق نصاً طويلاً ويتحول لمرفق تلقائياً |
| 🧠 **ذاكرة طويلة المدى** | يتعلم نظامك ومستواك ومشاريعك ويستخدمها في كل مشروع |
| 🔑 **أي مزود + كل النماذج** | Gemini (مجاني) · Groq (مجاني) · OpenRouter · OpenAI · Claude · DeepSeek · Mistral · Together · xAI · Ollama محلي — **يجلب كل النماذج المتاحة لحسابك لحظياً** بما فيها الجديدة، ويختار الأفضل للبرمجة |
| 📴 **بدون إنترنت** | Service Worker + IndexedDB: كل الواجهة والمشاريع والذاكرة على جهازك. **0 طلبات خارجية** غير نداء النموذج |
| 🔒 **خصوصية كاملة** | الخادم **لا يخزّن شيئاً** (Stateless relay). المفتاح في متصفحك فقط |
| 💾 **نسخة احتياطية** | تصدير/استيراد كل البيانات كملف JSON |
| 📱 **PWA** | يُثبَّت كتطبيق على الموبايل والكمبيوتر |

## 🛠️ الـ Stack
| الطبقة | التقنية |
|---|---|
| Edge relay | **Hono + TypeScript** على Cloudflare Pages (stateless — لا قاعدة بيانات) |
| تخزين | **IndexedDB** في المتصفح (`store.js`) + Service Worker cache |
| LLM | OpenAI-compatible + Anthropic native — Streaming SSE |
| Frontend | Vanilla JS · Tailwind (مُجمَّع محلياً 13KB) · marked · highlight.js · DOMPurify · JSZip — **كلها محلية** |

## 🧩 API (الخادم)
| Method | Path | الوصف |
|---|---|---|
| GET | `/api/meta` | المزودون، النماذج الافتراضية، الإعدادات |
| POST | `/api/models` | `{apiKey, baseUrl}` → اكتشاف كل نماذج الحساب لحظياً (Gemini native / OpenAI `/models` / Anthropic) |
| POST | `/api/chat` | **SSE** — `{messages[], memories[], model, os, want_title, want_facts}` → `meta` · `delta` · `status` · `error` · `done{title,facts,tokens}` |
| GET | `/sw.js` | Service Worker |

BYOK headers: `x-nova-key`, `x-nova-base-url`, `x-nova-cheap-model`

## 📖 كيف تستخدمه (3 خطوات)
1. افتح https://nova-code-9u9.pages.dev
2. **المزود و مفتاح API** → اختر **Google Gemini** → اضغط "احصل على مفتاح من هنا" (https://aistudio.google.com/app/apikey) → الصق المفتاح → **اتصال وجلب النماذج**. ستظهر كل نماذج حسابك وسيُختار الأفضل للبرمجة تلقائياً.
3. اكتب: «اعمل لي موقع لمطعم فيه المنيو وحجز» → تحصل على كل الملفات + معاينة حية + ZIP + خطوات التشغيل.

لو خلص رصيد المفتاح: افتح نفس النافذة وبدّل لمزود آخر (Groq مجاني) في ثوانٍ.

## 🚀 التشغيل محلياً
```bash
npm install
npm run build              # يبني Tailwind + Worker
pm2 start ecosystem.config.cjs   # http://localhost:3000
```
اختياري: `.dev.vars` بـ `OPENAI_API_KEY`/`OPENAI_BASE_URL` كمفتاح خادم افتراضي.

## ☁️ النشر
```bash
npm run build && npx wrangler pages deploy dist --project-name nova-code
```
- **الحالة**: ✅ منشور — 2026-09-18

## 🔜 خطوات مقترحة
- [ ] معاينة React/Vite داخل المتصفح (WebContainers)
- [ ] Push مباشر إلى GitHub من الشات
- [ ] تحويل صورة تصميم إلى كود (Vision)
- [ ] وضع فاتح
