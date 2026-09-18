/* NOVA CODE frontend v2 — vanilla JS (part 1: core) */
window.N = window.N || {}
;(() => {
  const N = window.N
  const $ = (s) => document.querySelector(s)
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const state = {
    meta: null,
    conversations: [],
    current: null,
    model: '',
    streaming: false,
    abort: null,
    attachments: [],
    files: {}, // path -> content (extracted from assistant messages)
    activeFile: null,
    discovered: null, // { provider, models, cheap }
  }

  // ---------- Settings (browser-only) ----------
  const SETTINGS_KEY = 'nova_settings'
  const settings = Object.assign({ provider: '', apiKey: '', baseUrl: '', model: '', cheapModel: '', models: null }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'))
  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  const usingByok = () => !!(settings.apiKey && settings.baseUrl)
  const byokHeaders = () => usingByok() ? { 'x-nova-key': settings.apiKey, 'x-nova-base-url': settings.baseUrl, 'x-nova-cheap-model': settings.cheapModel || settings.model || '' } : {}
  const detectOS = () => { const u = navigator.userAgent; if (/Windows/.test(u)) return 'Windows'; if (/Android/.test(u)) return 'Android'; if (/iPhone|iPad/.test(u)) return 'iOS'; if (/Mac/.test(u)) return 'macOS'; if (/Linux/.test(u)) return 'Linux'; return '' }

  // ---------- Markdown ----------
  marked.setOptions({ breaks: true, gfm: true })
  const renderer = new marked.Renderer()
  renderer.code = function (codeOrToken, infostring) {
    const text = typeof codeOrToken === 'string' ? codeOrToken : (codeOrToken?.text ?? '')
    const lang = typeof codeOrToken === 'string' ? infostring : codeOrToken?.lang
    const language = (lang || '').trim().split(/\s/)[0]
    let highlighted
    try {
      if (typeof hljs === 'undefined') throw 0
      const valid = language && hljs.getLanguage(language)
      highlighted = valid ? hljs.highlight(text, { language }).value : (text.length < 20000 ? hljs.highlightAuto(text).value : esc(text))
    } catch { highlighted = esc(text) }
    const id = 'c' + Math.random().toString(36).slice(2, 9)
    const isHtml = /^html?$/.test(language) || /^\s*<!doctype html|^\s*<html/i.test(text)
    return `<div class="code-block"><div class="code-head"><span>${esc(language || 'code')}</span><span class="cb-actions">${isHtml ? `<button data-preview="${id}"><i class="fas fa-eye"></i> Preview</button>` : ''}<button data-dl="${id}"><i class="fas fa-download"></i></button><button data-copy="${id}"><i class="far fa-copy"></i> Copy</button></span></div><pre><code id="${id}" class="hljs" data-lang="${esc(language)}">${highlighted}</code></pre></div>`
  }
  marked.use({ renderer })
  const md = (text) => {
    try {
      const html = marked.parse(text || '')
      return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-copy', 'data-dl', 'data-preview', 'data-lang'] }) : html
    } catch { return `<p>${esc(text)}</p>` }
  }

  // ---------- Toast ----------
  let toastTimer
  const toast = (msg, ms = 2200) => { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms) }

  // ---------- API ----------
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.message || j.error || r.statusText)
    return j
  }

  // ---------- Sidebar ----------
  const openSidebar = (o) => { $('#sidebar').classList.toggle('open', o); $('#sidebar-backdrop').classList.toggle('hidden', !o) }
  $('#btn-open-sidebar').onclick = () => openSidebar(true)
  $('#btn-close-sidebar').onclick = () => openSidebar(false)
  $('#sidebar-backdrop').onclick = () => openSidebar(false)

  const groupLabel = (d) => {
    const diff = (Date.now() - new Date(d.replace(' ', 'T'))) / 864e5
    if (diff < 1) return 'اليوم'; if (diff < 2) return 'أمس'; if (diff < 7) return 'هذا الأسبوع'; if (diff < 30) return 'هذا الشهر'; return 'أقدم'
  }
  function renderConversations() {
    const q = $('#search-input').value.trim().toLowerCase()
    const list = $('#conversation-list'); list.innerHTML = ''
    let lastGroup = null
    const items = state.conversations.filter((c) => !q || c.title.toLowerCase().includes(q))
    if (!items.length) { list.appendChild(el('p', 'text-center text-xs text-slate-500 py-8', q ? 'لا نتائج' : 'لا توجد مشاريع بعد')); return }
    for (const c of items) {
      const g = c.pinned ? 'مثبّتة' : groupLabel(c.updated_at)
      if (g !== lastGroup) { list.appendChild(el('div', 'conv-group', g)); lastGroup = g }
      const item = el('div', 'conv-item' + (state.current?.id === c.id ? ' active' : ''))
      item.innerHTML = `<i class="fas fa-code text-xs text-violet-400"></i><span class="conv-title"></span>
        <span class="conv-actions"><button data-act="pin" title="تثبيت"><i class="fas fa-thumbtack ${c.pinned ? 'text-violet-400' : ''}"></i></button><button data-act="del" title="حذف"><i class="fas fa-trash"></i></button></span>`
      item.querySelector('.conv-title').textContent = c.title
      item.onclick = (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act
        if (act === 'pin') return togglePin(c)
        if (act === 'del') return deleteConversation(c.id)
        loadConversation(c.id); openSidebar(false)
      }
      list.appendChild(item)
    }
  }
  $('#search-input').oninput = renderConversations
  async function refreshConversations() { state.conversations = await N.store.listConversations(); renderConversations() }
  async function togglePin(c) { await N.store.updateConversation(c.id, { pinned: c.pinned ? 0 : 1 }); refreshConversations() }
  async function deleteConversation(id) {
    if (!confirm('حذف هذا المشروع نهائياً؟')) return
    await N.store.deleteConversation(id)
    if (state.current?.id === id) N.newChat()
    refreshConversations(); toast('تم الحذف')
  }

  // ---------- Model menu ----------
  function currentModels() {
    if (usingByok() && settings.models?.length) return settings.models
    return state.meta.models.map((m) => ({ id: m.id, name: m.name, desc: m.desc, tier: 'top' }))
  }
  function setModelUI() {
    const m = currentModels().find((x) => x.id === state.model)
    $('#model-name').textContent = m ? (m.name.length > 28 ? m.id : m.name) : state.model
  }
  function setModel(id) {
    state.model = id; setModelUI()
    if (usingByok()) { settings.model = id; saveSettings() }
    if (state.current) N.store.updateConversation(state.current.id, { model: id }).catch(() => {})
    buildModelMenu()
  }
  function buildModelMenu(filter = '') {
    const mm = $('#model-menu'); mm.innerHTML = ''
    const models = currentModels()
    const head = el('div', 'px-2 pt-1')
    head.innerHTML = `<div class="flex items-center justify-between mb-1"><span class="text-[11px] text-slate-400">${usingByok() ? `<i class="fas fa-key text-emerald-400"></i> ${esc(settings.provider || 'مزودك')} · ${models.length} نموذج` : '<i class="fas fa-server"></i> نماذج الخادم'}</span><button id="mm-refresh" class="text-[11px] text-violet-300 hover:underline">${usingByok() ? '<i class="fas fa-rotate"></i> تحديث' : '<i class="fas fa-key"></i> أضف مفتاحك'}</button></div>`
    mm.appendChild(head)
    if (models.length > 8) {
      const s = el('input', 'menu-search'); s.placeholder = 'Search models...'; s.value = filter
      s.onclick = (e) => e.stopPropagation(); s.oninput = () => buildModelMenu(s.value)
      mm.appendChild(s); setTimeout(() => s.focus(), 0)
    }
    const scroll = el('div', 'menu-scroll'); mm.appendChild(scroll)
    const f = filter.toLowerCase()
    const groups = [['top', '⭐ الأقوى للبرمجة'], ['fast', '⚡ سريع'], ['other', 'أخرى']]
    for (const [tier, label] of groups) {
      const rows = models.filter((m) => (m.tier || 'top') === tier && (!f || m.id.toLowerCase().includes(f) || (m.name || '').toLowerCase().includes(f)))
      if (!rows.length) continue
      if (models.length > 4) scroll.appendChild(el('div', 'menu-group', label))
      for (const m of rows) {
        const b = el('button', 'model-row' + (m.id === state.model ? ' active' : ''))
        b.innerHTML = `<i class="fas fa-microchip text-cyan-400 text-xs"></i><span class="min-w-0"><div class="mr-id">${esc(m.id)}${m.recommended ? ' <span class="text-amber-400">★</span>' : ''}</div><div class="mr-desc truncate">${esc(m.name !== m.id ? m.name + (m.desc ? ' — ' : '') : '')}${esc(m.desc || '')}${m.context ? ` · ${Math.round(m.context / 1000)}K` : ''}</div></span>`
        b.onclick = () => { setModel(m.id); closeMenus() }
        scroll.appendChild(b)
      }
    }
    if (!scroll.children.length) scroll.appendChild(el('p', 'text-xs text-slate-500 text-center py-4', 'لا نتائج'))
    head.querySelector('#mm-refresh').onclick = (e) => { e.stopPropagation(); closeMenus(); if (usingByok()) refreshModels(true); else N.openSettings() }
  }
  const closeMenus = () => document.querySelectorAll('.menu').forEach((m) => m.classList.add('hidden'))
  $('#model-btn').onclick = (e) => { e.stopPropagation(); const m = $('#model-menu'); const h = m.classList.contains('hidden'); closeMenus(); if (h) { buildModelMenu(); m.classList.remove('hidden') } }
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus() })

  async function refreshModels(showToast) {
    if (!usingByok()) return
    try {
      const r = await api('/api/models', { method: 'POST', body: JSON.stringify({ apiKey: settings.apiKey, baseUrl: settings.baseUrl }) })
      settings.models = r.models; settings.cheapModel = r.cheap
      if (!settings.model || !r.models.some((m) => m.id === settings.model)) settings.model = r.models.find((m) => m.recommended)?.id || r.models[0]?.id || ''
      saveSettings(); state.model = settings.model; setModelUI(); updateKeyStatus()
      if (showToast) toast(`تم تحديث القائمة: ${r.models.length} نموذج`)
      return r
    } catch (e) { if (showToast) toast('فشل جلب النماذج: ' + e.message, 4000); throw e }
  }
  const updateKeyStatus = () => {
    const b = $('#key-status')
    if (usingByok()) { b.textContent = settings.provider || 'مفتاحك'; b.style.color = '#34d399' }
    else if (state.meta?.server_key_configured) { b.textContent = 'الخادم'; b.style.color = '' }
    else { b.textContent = 'مطلوب'; b.style.color = '#f87171' }
  }

  // ---------- Suggestions ----------
  const SUGGESTIONS = [
    ['fa-store', 'موقع لمشروعي', 'اعمل لي موقع احترافي لمطعم: الصفحة الرئيسية، المنيو بالصور، نموذج حجز، وزر واتساب. عربي وشكله عصري'],
    ['fa-robot', 'بوت تليجرام', 'اعمل لي بوت تليجرام يستقبل طلبات العملاء ويحفظها ويبعت لي إشعار بكل طلب جديد'],
    ['fa-mobile-screen', 'تطبيق موبايل', 'اعمل لي تطبيق موبايل بسيط لتتبع المصروفات اليومية مع رسم بياني شهري'],
    ['fa-file-invoice-dollar', 'أداة عمل', 'اعمل لي برنامج يعمل فواتير PDF من بيانات أدخلها في نموذج ويحفظ سجل العملاء'],
    ['fa-bug', 'إصلاح خطأ', 'الكود بتاعي بيطلع خطأ — (الصق الكود ورسالة الخطأ هنا وأنا هصلحه)'],
    ['fa-gamepad', 'لعبة', 'اعمل لي لعبة Snake كاملة في صفحة HTML واحدة أقدر أفتحها بالمتصفح مباشرة'],
  ]
  function renderSuggestions() {
    const box = $('#suggestions'); box.innerHTML = ''
    for (const [icon, title, prompt] of SUGGESTIONS) {
      const b = el('button', 'suggestion')
      b.innerHTML = `<i class="fas ${icon}"></i><div class="s-title">${title}</div><div class="s-desc">${esc(prompt)}</div>`
      b.onclick = () => { N.input.value = prompt; N.autoGrow(); N.input.focus(); if (!/الصق/.test(prompt)) N.send() }
      box.appendChild(b)
    }
  }
  Object.assign(N, { $, el, esc, state, settings, saveSettings, usingByok, byokHeaders, detectOS, md, toast, api, openSidebar, renderConversations, refreshConversations, deleteConversation, currentModels, setModelUI, setModel, buildModelMenu, closeMenus, refreshModels, updateKeyStatus, renderSuggestions })
})()
