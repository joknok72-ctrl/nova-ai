/* NOVA CODE frontend v4 — part 1: core, providers (multi-key), model picker */
window.N = window.N || {}
;(() => {
  const N = window.N
  const $ = (s) => document.querySelector(s)
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const isMobile = () => window.innerWidth < 1024

  const state = { meta: null, conversations: [], current: null, model: '', providerId: '', streaming: false, abort: null, attachments: [], files: {}, activeFile: null }

  // ---------- Settings (browser-only) ----------
  // providers: { [id]: { apiKey, baseUrl, models: [...], cheap, name, updated } }
  const SETTINGS_KEY = 'nova_settings_v4'
  const settings = Object.assign({ providers: {}, active: '', model: '', web: true, instructions: '' }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'))
  // migrate v3 single-key settings
  try { const old = JSON.parse(localStorage.getItem('nova_settings') || 'null'); if (old?.apiKey && !Object.keys(settings.providers).length) { const id = old.provider || 'custom'; settings.providers[id] = { apiKey: old.apiKey, baseUrl: old.baseUrl, models: old.models || [], cheap: old.cheapModel || '' }; settings.active = id; settings.model = old.model || ''; localStorage.removeItem('nova_settings') } } catch {}
  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  const connected = () => Object.entries(settings.providers).filter(([, p]) => p.apiKey && p.baseUrl)
  const activeProv = () => settings.providers[settings.active]
  const usingByok = () => !!(activeProv()?.apiKey)
  const byokHeaders = () => { const p = activeProv(); return p?.apiKey ? { 'x-nova-key': p.apiKey, 'x-nova-base-url': p.baseUrl, 'x-nova-cheap-model': p.cheap || settings.model || '' } : {} }
  const detectOS = () => { const u = navigator.userAgent; if (/Windows/.test(u)) return 'Windows'; if (/Android/.test(u)) return 'Android'; if (/iPhone|iPad/.test(u)) return 'iOS'; if (/Mac/.test(u)) return 'macOS'; if (/Linux/.test(u)) return 'Linux'; return '' }
  const provInfo = (id) => state.meta?.providers.find((p) => p.id === id) || { id, name: id, note: '' }

  // ---------- Markdown ----------
  marked.setOptions({ breaks: true, gfm: true })
  const renderer = new marked.Renderer()
  renderer.code = function (codeOrToken, infostring) {
    const text = typeof codeOrToken === 'string' ? codeOrToken : (codeOrToken?.text ?? '')
    const lang = typeof codeOrToken === 'string' ? infostring : codeOrToken?.lang
    const language = (lang || '').trim().split(/\s/)[0]
    let highlighted
    try { if (typeof hljs === 'undefined') throw 0; const valid = language && hljs.getLanguage(language); highlighted = valid ? hljs.highlight(text, { language }).value : (text.length < 20000 ? hljs.highlightAuto(text).value : esc(text)) } catch { highlighted = esc(text) }
    const id = 'c' + Math.random().toString(36).slice(2, 9)
    const isHtml = /^html?$/.test(language) || /^\s*<!doctype html|^\s*<html/i.test(text)
    return `<div class="code-block"><div class="code-head"><span>${esc(language || 'code')}</span><span class="cb-actions">${isHtml ? `<button data-preview="${id}"><i class="fas fa-eye"></i></button>` : ''}<button data-dl="${id}"><i class="fas fa-download"></i></button><button data-copy="${id}"><i class="far fa-copy"></i> Copy</button></span></div><pre><code id="${id}" class="hljs" data-lang="${esc(language)}">${highlighted}</code></pre></div>`
  }
  marked.use({ renderer })
  const md = (text) => { try { const html = marked.parse(text || ''); return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-copy', 'data-dl', 'data-preview', 'data-lang'] }) : html } catch { return `<p>${esc(text)}</p>` } }

  // ---------- Toast ----------
  let toastTimer
  const toast = (msg, ms = 2200) => { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms) }

  // ---------- API ----------
  const api = async (url, opts = {}) => { const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || j.error || r.statusText); return j }

  // ---------- Sidebar ----------
  const openSidebar = (o) => { $('#sidebar').classList.toggle('open', o); $('#sidebar-backdrop').classList.toggle('hidden', !o) }
  $('#btn-open-sidebar').onclick = () => openSidebar(true)
  $('#btn-close-sidebar').onclick = () => openSidebar(false)
  $('#sidebar-backdrop').onclick = () => openSidebar(false)

  const groupLabel = (d) => { const diff = (Date.now() - new Date(d.replace(' ', 'T'))) / 864e5; if (diff < 1) return 'اليوم'; if (diff < 2) return 'أمس'; if (diff < 7) return 'هذا الأسبوع'; if (diff < 30) return 'هذا الشهر'; return 'أقدم' }
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
      item.innerHTML = `<i class="fas fa-code text-xs text-violet-400"></i><span class="conv-title"></span><span class="conv-actions"><button data-act="pin" title="تثبيت"><i class="fas fa-thumbtack ${c.pinned ? 'text-violet-400' : ''}"></i></button><button data-act="del" title="حذف"><i class="fas fa-trash"></i></button></span>`
      item.querySelector('.conv-title').textContent = c.title
      item.onclick = (e) => { const act = e.target.closest('[data-act]')?.dataset.act; if (act === 'pin') return togglePin(c); if (act === 'del') return deleteConversation(c.id); N.loadConversation(c.id); openSidebar(false) }
      list.appendChild(item)
    }
  }
  $('#search-input').oninput = renderConversations
  async function refreshConversations() { state.conversations = await N.store.listConversations(); renderConversations() }
  async function togglePin(c) { await N.store.updateConversation(c.id, { pinned: c.pinned ? 0 : 1 }); refreshConversations() }
  async function deleteConversation(id) { if (!confirm('حذف هذا المشروع نهائياً؟')) return; await N.store.deleteConversation(id); if (state.current?.id === id) N.newChat(); refreshConversations(); toast('تم الحذف') }

  // ---------- Models (grouped by provider) ----------
  function allModelGroups() {
    const groups = []
    for (const [id, p] of connected()) groups.push({ id, name: provInfo(id).name, models: p.models || [], free: provInfo(id).free })
    if (!groups.length || state.meta?.server_key_configured) groups.push({ id: '', name: 'نماذج الخادم', models: state.meta?.models.map((m) => ({ id: m.id, name: m.name, desc: m.desc, tier: 'top' })) || [] })
    return groups
  }
  function findModel(provId, modelId) { const g = allModelGroups().find((g) => g.id === provId); return g?.models.find((m) => m.id === modelId) }
  function setModelUI() {
    const m = findModel(state.providerId, state.model)
    $('#model-name').textContent = m ? (m.name && m.name.length <= 26 ? m.name : m.id) : (state.model || '—')
    const pv = $('#model-prov'); if (pv) pv.textContent = state.providerId ? provInfo(state.providerId).name.split(' ')[0] : 'الخادم'
  }
  function setModel(provId, id) {
    state.providerId = provId; state.model = id
    settings.active = provId; settings.model = id; saveSettings()
    setModelUI()
    if (state.current) N.store.updateConversation(state.current.id, { model: id, provider: provId }).catch(() => {})
  }
  function buildModelMenu(filter = '') {
    const mm = $('#model-menu'); mm.innerHTML = ''
    const groups = allModelGroups()
    const total = groups.reduce((n, g) => n + g.models.length, 0)
    const head = el('div', 'px-2 pt-1 flex items-center justify-between mb-1')
    head.innerHTML = `<span class="text-[11px] text-slate-400">${total} نموذج · ${connected().length} مزود متصل</span><button id="mm-manage" class="text-[11px] text-violet-300 hover:underline"><i class="fas fa-key"></i> إدارة المفاتيح</button>`
    mm.appendChild(head)
    if (total > 8) { const s = el('input', 'menu-search'); s.placeholder = 'Search models...'; s.value = filter; s.onclick = (e) => e.stopPropagation(); s.oninput = () => buildModelMenu(s.value); mm.appendChild(s); if (!isMobile()) setTimeout(() => s.focus(), 0) }
    const scroll = el('div', 'menu-scroll'); mm.appendChild(scroll)
    const f = filter.toLowerCase()
    for (const g of groups) {
      const rows = g.models.filter((m) => !f || m.id.toLowerCase().includes(f) || (m.name || '').toLowerCase().includes(f))
      if (!rows.length) continue
      const gh = el('div', 'menu-group flex items-center gap-2'); gh.innerHTML = `<i class="fas ${g.id ? 'fa-key text-emerald-400' : 'fa-server'}"></i>${esc(g.name)} <span class="opacity-60">(${rows.length})</span>${g.free ? '<span class="free-badge !ms-auto">مجاني</span>' : ''}`
      scroll.appendChild(gh)
      const shown = f ? rows : rows.slice(0, 40)
      for (const m of shown) {
        const b = el('button', 'model-row' + (m.id === state.model && g.id === state.providerId ? ' active' : ''))
        b.innerHTML = `<i class="fas fa-microchip text-cyan-400 text-xs"></i><span class="min-w-0"><div class="mr-id">${esc(m.id)}${m.recommended ? ' <span class="text-amber-400">★</span>' : ''}</div><div class="mr-desc truncate">${esc(m.name && m.name !== m.id ? m.name : '')}${m.context ? ` · ${Math.round(m.context / 1000)}K` : ''}</div></span>${m.tier === 'top' ? '<span class="tier-tag tier-top">قوي</span>' : m.tier === 'fast' ? '<span class="tier-tag tier-fast">سريع</span>' : ''}`
        b.onclick = () => { setModel(g.id, m.id); closeMenus() }
        scroll.appendChild(b)
      }
      if (!f && rows.length > 40) scroll.appendChild(el('div', 'text-[10px] text-slate-500 px-3 py-1', `+${rows.length - 40} أخرى — ابحث لعرضها`))
    }
    if (!scroll.children.length) scroll.appendChild(el('p', 'text-xs text-slate-500 text-center py-4', 'لا نتائج'))
    head.querySelector('#mm-manage').onclick = (e) => { e.stopPropagation(); closeMenus(); N.openSettings() }
  }
  const closeMenus = () => document.querySelectorAll('.menu').forEach((m) => m.classList.add('hidden'))
  $('#model-btn').onclick = (e) => { e.stopPropagation(); const m = $('#model-menu'); const h = m.classList.contains('hidden'); closeMenus(); if (h) { buildModelMenu(); m.classList.remove('hidden') } }
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu') && !e.target.closest('#model-btn')) closeMenus() })

  // Discover models for one provider (new models appear automatically)
  async function refreshProvider(id, showToast) {
    const p = settings.providers[id]; if (!p?.apiKey) return
    const r = await api('/api/models', { method: 'POST', body: JSON.stringify({ apiKey: p.apiKey, baseUrl: p.baseUrl }) })
    p.models = r.models; p.cheap = r.cheap; p.updated = Date.now(); saveSettings()
    if (settings.active === id && !r.models.some((m) => m.id === settings.model)) { settings.model = r.models.find((m) => m.recommended)?.id || r.models[0]?.id || ''; state.model = settings.model; saveSettings(); setModelUI() }
    if (showToast) toast(`${provInfo(id).name}: ${r.models.length} نموذج`)
    return r
  }
  async function refreshAllProviders() { for (const [id] of connected()) { try { await refreshProvider(id, false) } catch {} } setModelUI() }
  const updateKeyStatus = () => { const b = $('#key-status'); const n = connected().length; if (n) { b.textContent = `${n} متصل`; b.style.color = '#34d399' } else if (state.meta?.server_key_configured) { b.textContent = 'الخادم'; b.style.color = '' } else { b.textContent = 'مطلوب'; b.style.color = '#f87171' } }

  // ---------- Suggestions ----------
  const SUGGESTIONS = [
    ['fa-store', 'موقع لمشروعي', 'اعمل لي موقع احترافي لمطعم: الصفحة الرئيسية، المنيو بالصور، نموذج حجز، وزر واتساب. عربي وشكله عصري'],
    ['fa-robot', 'بوت تليجرام', 'اعمل لي بوت تليجرام يستقبل طلبات العملاء ويحفظها ويبعت لي إشعار بكل طلب جديد'],
    ['fa-mobile-screen', 'تطبيق موبايل', 'اعمل لي تطبيق موبايل بسيط لتتبع المصروفات اليومية مع رسم بياني شهري'],
    ['fa-gamepad', 'لعبة', 'اعمل لي لعبة Snake كاملة في صفحة HTML واحدة أقدر أفتحها بالمتصفح مباشرة'],
    ['fa-magnifying-glass', 'يبحث ويبني', 'ابحث عن أحدث نسخة من python-telegram-bot واعمل لي بوت بها يرد بالذكاء الاصطناعي'],
    ['fa-bug', 'إصلاح خطأ', 'الكود بتاعي بيطلع خطأ — (الصق الكود ورسالة الخطأ هنا وأنا هصلحه)'],
  ]
  function renderSuggestions() {
    const box = $('#suggestions'); box.innerHTML = ''
    for (const [icon, title, prompt] of SUGGESTIONS) { const b = el('button', 'suggestion'); b.innerHTML = `<i class="fas ${icon}"></i><div class="s-title">${title}</div><div class="s-desc">${esc(prompt)}</div>`; b.onclick = () => { N.input.value = prompt; N.autoGrow(); if (!/الصق/.test(prompt)) N.send(); else N.input.focus() }; box.appendChild(b) }
  }

  Object.assign(N, { $, el, esc, isMobile, state, settings, saveSettings, connected, activeProv, usingByok, byokHeaders, detectOS, provInfo, md, toast, api, openSidebar, renderConversations, refreshConversations, deleteConversation, allModelGroups, findModel, setModelUI, setModel, buildModelMenu, closeMenus, refreshProvider, refreshAllProviders, updateKeyStatus, renderSuggestions })
})()
