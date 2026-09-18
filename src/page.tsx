export const page = () => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>NOVA CODE — مبرمجك الخارق</title>
<meta name="description" content="NOVA CODE: مهندس برمجيات بالذكاء الاصطناعي يبني مشاريع كاملة، يصلح، يراجع، وينشر — أنت فقط تقول ماذا تريد">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop offset='0' stop-color='%238b5cf6'/><stop offset='1' stop-color='%2306b6d4'/></linearGradient></defs><rect width='100' height='100' rx='24' fill='url(%23g)'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='monospace' font-weight='bold'>&lt;/&gt;</text></svg>">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" rel="stylesheet">
<link href="/static/app.css" rel="stylesheet">
</head>
<body class="bg-[#0b0e14] text-slate-200">

<div id="app" class="flex h-[100dvh] overflow-hidden">

  <!-- Sidebar -->
  <aside id="sidebar" class="sidebar flex flex-col w-[280px] shrink-0 bg-[#0f131b] border-e border-white/5">
    <header class="p-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2.5">
        <span class="logo-orb"><span>&lt;/&gt;</span></span>
        <span class="font-extrabold text-lg tracking-tight">NOVA<span class="text-violet-400">CODE</span></span>
      </a>
      <button id="btn-close-sidebar" class="icon-btn lg:hidden" title="إغلاق"><i class="fas fa-times"></i></button>
    </header>

    <div class="px-3">
      <button id="btn-new-chat" class="w-full btn-primary"><i class="fas fa-plus"></i><span>مشروع جديد</span></button>
    </div>

    <div class="px-3 pt-3">
      <div class="relative">
        <i class="fas fa-search absolute top-1/2 -translate-y-1/2 start-3 text-slate-500 text-xs"></i>
        <input id="search-input" type="search" placeholder="ابحث في المشاريع..." class="w-full bg-white/5 border border-white/5 rounded-xl ps-9 pe-3 py-2 text-sm focus:outline-none focus:border-violet-500/50">
      </div>
    </div>

    <nav id="conversation-list" class="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"></nav>

    <footer class="p-3 border-t border-white/5 space-y-1">
      <button id="btn-settings" class="side-link"><i class="fas fa-key text-emerald-400"></i><span>المزود و مفتاح API</span><span id="key-status" class="badge"></span></button>
      <button id="btn-memory" class="side-link"><i class="fas fa-brain text-pink-400"></i><span>الذاكرة</span><span id="memory-count" class="badge">0</span></button>
      <button id="btn-stats" class="side-link"><i class="fas fa-chart-simple text-amber-400"></i><span>الإحصائيات</span></button>
      <button id="btn-about" class="side-link"><i class="fas fa-circle-info text-cyan-400"></i><span>عن NOVA CODE</span></button>
    </footer>
  </aside>
  <div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/60 z-30 lg:hidden"></div>

  <!-- Main -->
  <main class="flex-1 flex flex-col min-w-0 relative">
    <header class="topbar flex items-center gap-2 px-3 sm:px-5 h-14 border-b border-white/5 bg-[#0b0e14]/80 backdrop-blur sticky top-0 z-20">
      <button id="btn-open-sidebar" class="icon-btn lg:hidden"><i class="fas fa-bars"></i></button>

      <div class="relative">
        <button id="model-btn" class="chip"><i class="fas fa-microchip text-cyan-400"></i><span id="model-name">...</span><i class="fas fa-chevron-down text-[10px] opacity-60"></i></button>
        <div id="model-menu" class="menu hidden w-[340px]"></div>
      </div>
      <span class="chip chip-static hidden sm:flex" title="NOVA يختار تلقائياً طريقة العمل: بناء / إصلاح / مراجعة / تصميم"><i class="fas fa-bolt text-violet-400"></i><span>وضع تلقائي ذكي</span></span>

      <div class="flex-1"></div>
      <button id="btn-files" class="chip hidden"><i class="fas fa-folder-tree text-amber-400"></i><span>ملفات المشروع</span><span id="files-count" class="badge">0</span></button>
      <button id="btn-rename" class="icon-btn hidden" title="إعادة تسمية"><i class="fas fa-pen"></i></button>
      <button id="btn-export" class="icon-btn hidden" title="تصدير المحادثة Markdown"><i class="fas fa-file-export"></i></button>
      <button id="btn-delete" class="icon-btn hidden hover:text-red-400" title="حذف"><i class="fas fa-trash"></i></button>
    </header>

    <div class="flex-1 flex min-h-0">
      <section id="messages" class="flex-1 overflow-y-auto min-w-0">
        <div id="welcome" class="max-w-3xl mx-auto px-4 pt-8 sm:pt-16 pb-10">
          <div class="text-center mb-8">
            <div class="logo-orb logo-orb-lg mx-auto mb-5"><span>&lt;/&gt;</span></div>
            <h1 class="text-3xl sm:text-4xl font-extrabold mb-3">قولي عايز تبني <span class="grad-text">إيه</span>؟</h1>
            <p class="text-slate-400 text-base sm:text-lg leading-relaxed">أنا NOVA CODE — أختار لك اللغة والتقنيات وأكتب المشروع كامل بكل ملفاته، وأقولك خطوة بخطوة كيف تشغّله وتنشره. مش محتاج تعرف برمجة.</p>
          </div>
          <div id="suggestions" class="grid sm:grid-cols-2 gap-3"></div>
          <div class="mt-6 grid grid-cols-3 gap-2 text-center text-[11px] text-slate-500">
            <div class="feature"><i class="fas fa-file-code"></i>ملفات كاملة قابلة للتشغيل</div>
            <div class="feature"><i class="fas fa-eye"></i>معاينة حية للمواقع</div>
            <div class="feature"><i class="fas fa-file-zipper"></i>تنزيل المشروع ZIP</div>
          </div>
        </div>
        <div id="message-list" class="max-w-3xl mx-auto px-4 py-6 space-y-6 hidden"></div>
      </section>

      <!-- Files / Preview panel -->
      <aside id="files-panel" class="files-panel hidden">
        <header class="flex items-center gap-2 px-3 h-12 border-b border-white/5">
          <div class="tabs">
            <button class="tab active" data-tab="files"><i class="fas fa-folder-tree"></i> الملفات</button>
            <button class="tab" data-tab="preview"><i class="fas fa-eye"></i> معاينة</button>
          </div>
          <div class="flex-1"></div>
          <button id="btn-zip" class="chip !py-1" title="تنزيل كل الملفات كـ ZIP"><i class="fas fa-file-zipper text-amber-400"></i><span>ZIP</span></button>
          <button id="btn-close-files" class="icon-btn"><i class="fas fa-times"></i></button>
        </header>
        <div id="tab-files" class="flex-1 flex min-h-0">
          <nav id="file-tree" class="w-[190px] shrink-0 overflow-y-auto border-e border-white/5 py-2 text-xs"></nav>
          <div class="flex-1 flex flex-col min-w-0">
            <div id="file-head" class="flex items-center gap-2 px-3 h-9 text-xs text-slate-400 border-b border-white/5 mono" dir="ltr"></div>
            <pre id="file-view" class="flex-1 overflow-auto m-0 p-3 text-xs" dir="ltr"><code class="hljs"></code></pre>
          </div>
        </div>
        <div id="tab-preview" class="flex-1 hidden flex-col min-h-0">
          <div class="flex items-center gap-2 px-3 h-9 text-xs text-slate-400 border-b border-white/5">
            <select id="preview-file" class="bg-white/5 rounded px-2 py-1 mono text-xs" dir="ltr"></select>
            <button id="btn-preview-refresh" class="icon-btn !w-7 !h-7"><i class="fas fa-rotate"></i></button>
            <button id="btn-preview-open" class="icon-btn !w-7 !h-7" title="فتح في تبويب جديد"><i class="fas fa-up-right-from-square"></i></button>
          </div>
          <iframe id="preview-frame" class="flex-1 bg-white" sandbox="allow-scripts allow-forms allow-modals allow-popups" title="preview"></iframe>
        </div>
      </aside>
    </div>

    <footer class="composer-wrap">
      <div class="max-w-3xl mx-auto px-3 sm:px-4 pb-3 sm:pb-5">
        <div id="attachments" class="flex flex-wrap gap-1.5 mb-2 empty:hidden"></div>
        <div class="composer">
          <button id="btn-attach" class="icon-btn !w-9 !h-9 mb-0.5" title="إرفاق ملفات كود"><i class="fas fa-paperclip"></i></button>
          <input id="file-input" type="file" multiple class="hidden" accept=".js,.ts,.tsx,.jsx,.py,.html,.css,.json,.md,.txt,.sql,.yaml,.yml,.toml,.env,.sh,.go,.rs,.java,.kt,.swift,.dart,.php,.rb,.c,.cpp,.h,.cs,.vue,.svelte,.xml,.csv,.log,.ini,.cfg,.dockerfile,Dockerfile">
          <textarea id="composer-input" rows="1" placeholder="مثال: اعمل لي موقع لمطعم فيه المنيو وحجز… أو الصق كود/خطأ عشان أصلحه"></textarea>
          <div class="flex items-center gap-1.5 pb-1 pe-1">
            <button id="btn-stop" class="send-btn bg-red-500 hover:bg-red-600 hidden" title="إيقاف"><i class="fas fa-stop"></i></button>
            <button id="btn-send" class="send-btn" title="إرسال"><i class="fas fa-arrow-up"></i></button>
          </div>
        </div>
        <p class="text-center text-[11px] text-slate-500 mt-2"><span id="status-line">Enter للإرسال · Shift+Enter لسطر جديد · لو توقف الرد اكتب «كمّل»</span></p>
      </div>
    </footer>
  </main>
</div>

<!-- Modal -->
<div id="modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
  <div class="modal-card">
    <header class="flex items-center justify-between mb-4">
      <h2 id="modal-title" class="text-lg font-bold"></h2>
      <button id="modal-close" class="icon-btn"><i class="fas fa-times"></i></button>
    </header>
    <div id="modal-body" class="max-h-[70vh] overflow-y-auto"></div>
  </div>
</div>

<div id="toast" class="toast hidden"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="/static/app.js"></script>
<script src="/static/app2.js"></script>
</body>
</html>`
