export const page = () => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>NOVA CODE — مبرمجك الذكي</title>
<meta name="description" content="NOVA CODE: مهندس برمجيات بالذكاء الاصطناعي يبني ويصلح ويراجع أي كود — مشاريع كاملة من الصفر">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop offset='0' stop-color='%238b5cf6'/><stop offset='1' stop-color='%2306b6d4'/></linearGradient></defs><circle cx='50' cy='50' r='45' fill='url(%23g)'/><text x='50' y='66' font-size='48' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>N</text></svg>">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" rel="stylesheet">
<link href="/static/app.css" rel="stylesheet">
</head>
<body class="bg-[#0b0e14] text-slate-200">

<div id="app" class="flex h-[100dvh] overflow-hidden">

  <!-- Sidebar -->
  <aside id="sidebar" class="sidebar flex flex-col w-[290px] shrink-0 bg-[#0f131b] border-e border-white/5">
    <header class="p-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2.5">
        <span class="logo-orb"><span>N</span></span>
        <span class="font-extrabold text-lg tracking-tight">NOVA<span class="text-violet-400">CODE</span></span>
      </a>
      <button id="btn-close-sidebar" class="icon-btn lg:hidden" title="إغلاق"><i class="fas fa-times"></i></button>
    </header>

    <div class="px-3">
      <button id="btn-new-chat" class="w-full btn-primary">
        <i class="fas fa-plus"></i><span>مشروع / محادثة جديدة</span>
      </button>
    </div>

    <div class="px-3 pt-3">
      <div class="relative">
        <i class="fas fa-search absolute top-1/2 -translate-y-1/2 start-3 text-slate-500 text-xs"></i>
        <input id="search-input" type="search" placeholder="ابحث في المحادثات..." class="w-full bg-white/5 border border-white/5 rounded-xl ps-9 pe-3 py-2 text-sm focus:outline-none focus:border-violet-500/50">
      </div>
    </div>

    <nav id="conversation-list" class="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"></nav>

    <footer class="p-3 border-t border-white/5 space-y-1">
      <button id="btn-memory" class="side-link"><i class="fas fa-brain text-pink-400"></i><span>الذاكرة</span><span id="memory-count" class="badge">0</span></button>
      <button id="btn-stats" class="side-link"><i class="fas fa-chart-simple text-amber-400"></i><span>الإحصائيات</span></button>
      <button id="btn-settings" class="side-link"><i class="fas fa-gear text-slate-400"></i><span>الإعدادات و API</span><span id="key-status" class="badge"></span></button>
      <button id="btn-about" class="side-link"><i class="fas fa-circle-info text-cyan-400"></i><span>عن NOVA CODE</span></button>
    </footer>
  </aside>
  <div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/60 z-30 lg:hidden"></div>

  <!-- Main -->
  <main class="flex-1 flex flex-col min-w-0 relative">
    <header class="topbar flex items-center gap-2 px-3 sm:px-5 h-14 border-b border-white/5 bg-[#0b0e14]/80 backdrop-blur sticky top-0 z-20">
      <button id="btn-open-sidebar" class="icon-btn lg:hidden"><i class="fas fa-bars"></i></button>

      <div class="relative">
        <button id="persona-btn" class="chip"><i id="persona-icon" class="fas fa-hammer"></i><span id="persona-name">نوفا</span><i class="fas fa-chevron-down text-[10px] opacity-60"></i></button>
        <div id="persona-menu" class="menu hidden"></div>
      </div>

      <div class="relative">
        <button id="model-btn" class="chip"><i class="fas fa-microchip text-cyan-400"></i><span id="model-name">NOVA Ultra</span><i class="fas fa-chevron-down text-[10px] opacity-60"></i></button>
        <div id="model-menu" class="menu hidden"></div>
      </div>

      <div class="flex-1"></div>
      <button id="btn-rename" class="icon-btn hidden" title="إعادة تسمية"><i class="fas fa-pen"></i></button>
      <button id="btn-export" class="icon-btn hidden" title="تصدير Markdown"><i class="fas fa-download"></i></button>
      <button id="btn-delete" class="icon-btn hidden hover:text-red-400" title="حذف المحادثة"><i class="fas fa-trash"></i></button>
    </header>

    <section id="messages" class="flex-1 overflow-y-auto">
      <div id="welcome" class="max-w-3xl mx-auto px-4 pt-10 sm:pt-20 pb-10">
        <div class="text-center mb-10">
          <div class="logo-orb logo-orb-lg mx-auto mb-5"><span>N</span></div>
          <h1 class="text-3xl sm:text-4xl font-extrabold mb-3">أنا <span class="grad-text">NOVA CODE</span> — مبرمجك الخارق</h1>
          <p class="text-slate-400 text-base sm:text-lg">قولي عايز تبني إيه وأنا هكتب لك المشروع كامل — كل الملفات، أوامر التشغيل، والنشر. مواقع، تطبيقات، بوتات، APIs، سكربتات. مش محتاج تعرف برمجة.</p>
        </div>
        <div id="suggestions" class="grid sm:grid-cols-2 gap-3"></div>
      </div>
      <div id="message-list" class="max-w-3xl mx-auto px-4 py-6 space-y-6 hidden"></div>
    </section>

    <footer class="composer-wrap">
      <div class="max-w-3xl mx-auto px-3 sm:px-4 pb-3 sm:pb-5">
        <div class="composer">
          <textarea id="composer-input" rows="1" placeholder="اوصف اللي عايز تبنيه أو الصق الكود/الخطأ... (Enter للإرسال، Shift+Enter لسطر جديد)"></textarea>
          <div class="flex items-center gap-1.5 pb-1 pe-1">
            <button id="btn-stop" class="send-btn bg-red-500 hover:bg-red-600 hidden" title="إيقاف"><i class="fas fa-stop"></i></button>
            <button id="btn-send" class="send-btn" title="إرسال"><i class="fas fa-arrow-up"></i></button>
          </div>
        </div>
        <p class="text-center text-[11px] text-slate-500 mt-2">لو المشروع كبير وتوقف الرد، اكتب «كمّل». NOVA قد يخطئ — اختبر الكود قبل النشر.</p>
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
    <div id="modal-body" class="max-h-[65vh] overflow-y-auto"></div>
  </div>
</div>

<div id="toast" class="toast hidden"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"></script>
<script src="/static/app.js"></script>
</body>
</html>`
