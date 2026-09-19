export const page = () => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">
<title>NOVA CODE — مبرمجك الخارق</title>
<meta name="description" content="NOVA CODE: مهندس برمجيات بالذكاء الاصطناعي يبني مشاريع كاملة، يصلح، يراجع، يبحث على النت وينشر — أنت فقط تقول ماذا تريد">
<link rel="icon" href="/static/icon.svg">
<link rel="apple-touch-icon" href="/static/icon.svg">
<link rel="manifest" href="/static/manifest.json">
<meta name="theme-color" content="#0b0e14">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link href="/static/vendor/tw.css" rel="stylesheet">
<link href="/static/vendor/fa/all.min.css" rel="stylesheet">
<link href="/static/vendor/fonts/fonts.css" rel="stylesheet">
<link href="/static/vendor/hljs.css" rel="stylesheet">
<link href="/static/app.css" rel="stylesheet">
</head>
<body class="bg-[#0b0e14] text-slate-200">

<div id="app" class="flex h-[100dvh] overflow-hidden">

  <aside id="sidebar" class="sidebar flex flex-col w-[290px] max-w-[85vw] shrink-0 bg-[#0f131b] border-e border-white/5">
    <header class="p-4 pt-[max(1rem,env(safe-area-inset-top))] flex items-center justify-between">
      <a href="/" class="flex items-center gap-2.5"><span class="logo-orb"><span>&lt;/&gt;</span></span><span class="font-extrabold text-lg tracking-tight">NOVA<span class="text-violet-400">CODE</span></span></a>
      <button id="btn-close-sidebar" class="icon-btn lg:hidden" title="إغلاق"><i class="fas fa-times"></i></button>
    </header>
    <div class="px-3"><button id="btn-new-chat" class="w-full btn-primary"><i class="fas fa-plus"></i><span>مشروع جديد</span></button></div>
    <div class="px-3 pt-3"><div class="relative"><i class="fas fa-search absolute top-1/2 -translate-y-1/2 start-3 text-slate-500 text-xs"></i><input id="search-input" type="search" placeholder="ابحث في المشاريع..." class="w-full bg-white/5 border border-white/5 rounded-xl ps-9 pe-3 py-2.5 text-sm focus:outline-none focus:border-violet-500/50"></div></div>
    <nav id="conversation-list" class="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"></nav>
    <footer class="p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] border-t border-white/5 space-y-0.5">
      <button id="btn-settings" class="side-link"><i class="fas fa-key text-emerald-400"></i><span>المزودون و مفاتيح API</span><span id="key-status" class="badge"></span></button>
      <button id="btn-instructions" class="side-link"><i class="fas fa-brain text-pink-400"></i><span>تعليماتي الأساسية</span><span id="ins-status" class="badge"></span></button>
      <button id="btn-backup" class="side-link"><i class="fas fa-database text-sky-400"></i><span>نسخة احتياطية / استيراد</span></button>
      <button id="btn-stats" class="side-link"><i class="fas fa-chart-simple text-amber-400"></i><span>الإحصائيات</span></button>
      <button id="btn-about" class="side-link"><i class="fas fa-circle-info text-cyan-400"></i><span>عن NOVA CODE</span></button>
    </footer>
  </aside>
  <div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/60 z-30 lg:hidden"></div>

  <main class="flex-1 flex flex-col min-w-0 relative">
    <header class="topbar flex items-center gap-1.5 px-2 sm:px-4 h-[52px] pt-[env(safe-area-inset-top)] box-content border-b border-white/5 bg-[#0b0e14]/85 backdrop-blur sticky top-0 z-20">
      <button id="btn-open-sidebar" class="icon-btn lg:hidden"><i class="fas fa-bars"></i></button>
      <div class="relative min-w-0">
        <button id="model-btn" class="chip max-w-[46vw] sm:max-w-none"><i class="fas fa-microchip text-cyan-400 shrink-0"></i><span class="truncate"><span id="model-prov" class="text-[10px] text-slate-400 me-1 hidden sm:inline"></span><span id="model-name">...</span></span><i class="fas fa-chevron-down text-[10px] opacity-60 shrink-0"></i></button>
        <div id="model-menu" class="menu hidden"></div>
      </div>
      <button id="btn-web" class="icon-btn web-btn" title="البحث على النت"><i class="fas fa-globe"></i></button>
      <div class="flex-1"></div>
      <button id="btn-files" class="chip hidden !px-2.5"><i class="fas fa-folder-tree text-amber-400"></i><span class="hidden sm:inline">الملفات</span><span id="files-count" class="badge">0</span></button>
      <button id="btn-share" class="icon-btn hidden" title="مشاركة المشروع برابط"><i class="fas fa-share-nodes"></i></button>
      <button id="btn-rename" class="icon-btn hidden" title="إعادة تسمية"><i class="fas fa-pen"></i></button>
      <button id="btn-export" class="icon-btn hidden hidden-xs" title="تصدير المحادثة"><i class="fas fa-file-export"></i></button>
      <button id="btn-delete" class="icon-btn hidden hover:text-red-400" title="حذف"><i class="fas fa-trash"></i></button>
    </header>

    <div class="flex-1 flex min-h-0">
      <section id="messages" class="flex-1 overflow-y-auto min-w-0 overscroll-contain">
        <div id="welcome" class="max-w-3xl mx-auto px-4 pt-6 sm:pt-16 pb-8">
          <div class="text-center mb-6 sm:mb-8">
            <div class="logo-orb logo-orb-lg mx-auto mb-4"><span>&lt;/&gt;</span></div>
            <h1 class="text-[26px] sm:text-4xl font-extrabold mb-2 leading-tight">قولي عايز تبني <span class="grad-text">إيه</span>؟</h1>
            <p class="text-slate-400 text-sm sm:text-lg leading-relaxed">أختار لك التقنيات وأكتب المشروع كامل بكل ملفاته، وأبحث على النت لو احتجت، وأقولك خطوة بخطوة كيف تشغّله. مش محتاج تعرف برمجة.</p>
          </div>
          <div id="suggestions" class="grid sm:grid-cols-2 gap-2.5"></div>
          <div class="mt-5 grid grid-cols-4 gap-1.5 text-center text-[10px] sm:text-[11px] text-slate-500">
            <div class="feature"><i class="fas fa-file-code"></i>ملفات كاملة</div>
            <div class="feature"><i class="fas fa-camera"></i>صورة → كود</div>
            <div class="feature"><i class="fas fa-eye"></i>معاينة حية</div>
            <div class="feature"><i class="fas fa-play"></i>تشغيل Python/JS</div>
          </div>
        </div>
        <div id="message-list" class="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-5 hidden"></div>
      </section>

      <aside id="files-panel" class="files-panel hidden">
        <header class="flex items-center gap-2 px-2 sm:px-3 h-12 pt-[env(safe-area-inset-top)] box-content border-b border-white/5">
          <button id="btn-close-files" class="icon-btn"><i class="fas fa-arrow-right"></i></button>
          <div class="tabs"><button class="tab active" data-tab="files"><i class="fas fa-folder-tree"></i> الملفات</button><button class="tab" data-tab="preview"><i class="fas fa-eye"></i> معاينة</button></div>
          <div class="flex-1"></div>
          <button id="btn-zip" class="chip !py-1.5" title="تنزيل كل الملفات ZIP"><i class="fas fa-file-zipper text-amber-400"></i><span>ZIP</span></button>
        </header>
        <div id="tab-files" class="flex-1 flex flex-col lg:flex-row min-h-0">
          <nav id="file-tree" class="lg:w-[190px] shrink-0 overflow-x-auto lg:overflow-y-auto border-b lg:border-b-0 lg:border-e border-white/5 py-1.5 text-xs flex lg:block gap-1 px-1 lg:px-0"></nav>
          <div class="flex-1 flex flex-col min-w-0 min-h-0">
            <div id="file-head" class="flex items-center gap-2 px-3 h-9 text-xs text-slate-400 border-b border-white/5 mono" dir="ltr"></div>
            <pre id="file-view" class="flex-1 overflow-auto m-0 p-3 text-xs" dir="ltr"><code class="hljs"></code></pre>
          </div>
        </div>
        <div id="tab-preview" class="flex-1 hidden flex-col min-h-0">
          <div class="flex items-center gap-2 px-3 h-9 text-xs text-slate-400 border-b border-white/5">
            <select id="preview-file" class="bg-white/5 rounded px-2 py-1 mono text-xs max-w-[55vw]" dir="ltr"></select>
            <button id="btn-preview-refresh" class="icon-btn !w-7 !h-7"><i class="fas fa-rotate"></i></button>
            <button id="btn-preview-open" class="icon-btn !w-7 !h-7" title="فتح في تبويب جديد"><i class="fas fa-up-right-from-square"></i></button>
          </div>
          <iframe id="preview-frame" class="flex-1 bg-white" sandbox="allow-scripts allow-forms allow-modals allow-popups" title="preview"></iframe>
        </div>
      </aside>
    </div>

    <footer class="composer-wrap">
      <div class="max-w-3xl mx-auto px-2 sm:px-4 pb-[max(.5rem,env(safe-area-inset-bottom))] sm:pb-5">
        <div id="attachments" class="flex flex-wrap gap-1.5 mb-2 empty:hidden"></div>
        <div class="composer">
          <button id="btn-attach" class="icon-btn !w-10 !h-10 mb-0.5 shrink-0" title="إرفاق ملفات كود"><i class="fas fa-paperclip"></i></button>
          <button id="btn-image" class="icon-btn !w-10 !h-10 mb-0.5 shrink-0" title="صورة / لقطة شاشة / كاميرا"><i class="fas fa-camera"></i></button>
          <input id="image-input" type="file" multiple accept="image/*" class="hidden">
          <input id="file-input" type="file" multiple class="hidden" accept=".js,.ts,.tsx,.jsx,.py,.html,.css,.json,.md,.txt,.sql,.yaml,.yml,.toml,.env,.sh,.go,.rs,.java,.kt,.swift,.dart,.php,.rb,.c,.cpp,.h,.cs,.vue,.svelte,.xml,.csv,.log,.ini,.cfg,Dockerfile">
          <textarea id="composer-input" rows="1" placeholder="اعمل لي موقع لمطعم… أو الصق كود/خطأ" enterkeyhint="send"></textarea>
          <div class="flex items-center gap-1.5 pb-0.5 pe-0.5 shrink-0">
            <button id="btn-mic" class="icon-btn !w-10 !h-10 mic-btn" title="إدخال صوتي"><i class="fas fa-microphone"></i></button>
            <button id="btn-stop" class="send-btn bg-red-500 hover:bg-red-600 hidden" title="إيقاف"><i class="fas fa-stop"></i></button>
            <button id="btn-send" class="send-btn" title="إرسال"><i class="fas fa-arrow-up"></i></button>
          </div>
        </div>
        <p class="text-center text-[10px] sm:text-[11px] text-slate-500 mt-1.5 truncate"><span id="status-line">لو توقف الرد اكتب «كمّل»</span></p>
      </div>
    </footer>
  </main>
</div>

<div id="modal" class="hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm">
  <div class="modal-card">
    <header class="flex items-center justify-between mb-3 sm:mb-4"><h2 id="modal-title" class="text-base sm:text-lg font-bold"></h2><button id="modal-close" class="icon-btn"><i class="fas fa-times"></i></button></header>
    <div id="modal-body" class="max-h-[72vh] overflow-y-auto overscroll-contain"></div>
  </div>
</div>

<div id="toast" class="toast hidden"></div>
<div id="net-badge" class="net-badge"><i class="fas fa-wifi-slash"></i> بدون إنترنت — كل شيء يعمل ما عدا إرسال رسالة جديدة</div>

<script src="/static/vendor/hljs.min.js"></script>
<script src="/static/vendor/marked.min.js"></script>
<script src="/static/vendor/purify.min.js"></script>
<script src="/static/vendor/jszip.min.js"></script>
<script src="/static/store.js"></script>
<script src="/static/app.js"></script>
<script src="/static/app2.js"></script>
<script src="/static/app3.js"></script>
<script>if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{})</script>
</body>
</html>`
