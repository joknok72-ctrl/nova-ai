/* NOVA frontend — vanilla JS, no framework */
(() => {
  const $ = (s) => document.querySelector(s)
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }

  const state = {
    meta: null,
    conversations: [],
    current: null, // { id, title, persona, model, messages }
    persona: 'nova',
    model: 'gpt-5.2',
    streaming: false,
    abort: null,
  }

  // ---------- Markdown ----------
  marked.setOptions({ breaks: true, gfm: true })
  const renderer = new marked.Renderer()
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  renderer.code = function (codeOrToken, infostring) {
    // marked v12 passes (code, lang); v13+ passes ({ text, lang })
    const text = typeof codeOrToken === 'string' ? codeOrToken : (codeOrToken?.text ?? '')
    const lang = typeof codeOrToken === 'string' ? infostring : codeOrToken?.lang
    const language = (lang || '').trim().split(/\s/)[0]
    let highlighted
    try {
      if (typeof hljs === 'undefined') throw 0
      const valid = language && hljs.getLanguage(language)
      highlighted = valid ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value
    } catch { highlighted = escapeHtml(text) }
    const id = 'c' + Math.random().toString(36).slice(2, 9)
    return `<div class="code-block"><div class="code-head"><span>${language || 'code'}</span><button data-copy="${id}"><i class="far fa-copy"></i> Copy</button></div><pre><code id="${id}" class="hljs">${highlighted}</code></pre></div>`
  }
  marked.use({ renderer })
  const md = (text) => {
    try {
      const html = marked.parse(text || '')
      return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-copy'] }) : html
    } catch { return `<p>${escapeHtml(text || '')}</p>` }
  }

  // ---------- Toast ----------
  let toastTimer
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200) }

  // ---------- BYOK settings (stored only in this browser) ----------
  const SETTINGS_KEY = 'nova_settings'
  const settings = Object.assign({ apiKey: '', baseUrl: '', model: '', cheapModel: '' }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'))
  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  const byokHeaders = () => settings.apiKey ? { 'x-nova-key': settings.apiKey, 'x-nova-base-url': settings.baseUrl || '', 'x-nova-cheap-model': settings.cheapModel || settings.model || '' } : {}
  const updateKeyStatus = () => { const b = $('#key-status'); if (settings.apiKey) { b.textContent = 'مفتاحك'; b.style.color = '#34d399' } else if (state.meta?.server_key_configured) { b.textContent = 'الخادم'; b.style.color = '' } else { b.textContent = 'مطلوب'; b.style.color = '#f87171' } }

  // ---------- API ----------
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
    return r.json()
  }

  // ---------- Sidebar ----------
  const openSidebar = (o) => { $('#sidebar').classList.toggle('open', o); $('#sidebar-backdrop').classList.toggle('hidden', !o) }
  $('#btn-open-sidebar').onclick = () => openSidebar(true)
  $('#btn-close-sidebar').onclick = () => openSidebar(false)
  $('#sidebar-backdrop').onclick = () => openSidebar(false)

  const groupLabel = (d) => {
    const date = new Date(d + 'Z'), now = new Date()
    const diff = (now - date) / 864e5
    if (diff < 1) return 'اليوم'
    if (diff < 2) return 'أمس'
    if (diff < 7) return 'هذا الأسبوع'
    if (diff < 30) return 'هذا الشهر'
    return 'أقدم'
  }

  function renderConversations() {
    const q = $('#search-input').value.trim().toLowerCase()
    const list = $('#conversation-list'); list.innerHTML = ''
    let lastGroup = null
    const items = state.conversations.filter((c) => !q || c.title.toLowerCase().includes(q))
    if (!items.length) { list.appendChild(el('p', 'text-center text-xs text-slate-500 py-8', q ? 'لا نتائج' : 'لا توجد محادثات بعد')); return }
    for (const c of items) {
      const g = c.pinned ? 'مثبّتة' : groupLabel(c.updated_at)
      if (g !== lastGroup) { list.appendChild(el('div', 'conv-group', g)); lastGroup = g }
      const p = state.meta.personas.find((x) => x.id === c.persona) || state.meta.personas[0]
      const item = el('div', 'conv-item' + (state.current?.id === c.id ? ' active' : ''))
      item.innerHTML = `<i class="fas ${p.icon} text-xs" style="color:${p.color}"></i><span class="conv-title"></span>
        <span class="conv-actions">
          <button data-act="pin" title="تثبيت"><i class="fas fa-thumbtack ${c.pinned ? 'text-violet-400' : ''}"></i></button>
          <button data-act="del" title="حذف"><i class="fas fa-trash"></i></button>
        </span>`
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

  async function refreshConversations() { state.conversations = await api('/api/conversations'); renderConversations() }
  async function togglePin(c) { await api(`/api/conversations/${c.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !c.pinned }) }); refreshConversations() }
  async function deleteConversation(id) {
    if (!confirm('حذف هذه المحادثة نهائياً؟')) return
    await api(`/api/conversations/${id}`, { method: 'DELETE' })
    if (state.current?.id === id) newChat()
    refreshConversations(); toast('تم الحذف')
  }

  // ---------- Persona / Model menus ----------
  function setPersona(id) {
    state.persona = id
    const p = state.meta.personas.find((x) => x.id === id)
    $('#persona-icon').className = `fas ${p.icon}`; $('#persona-icon').style.color = p.color
    $('#persona-name').textContent = p.nameAr
    renderSuggestions()
    if (state.current) api(`/api/conversations/${state.current.id}`, { method: 'PATCH', body: JSON.stringify({ persona: id }) }).then(refreshConversations)
  }
  function setModel(id) {
    state.model = id
    $('#model-name').textContent = state.meta.models.find((m) => m.id === id)?.name || id
    if (state.current) api(`/api/conversations/${state.current.id}`, { method: 'PATCH', body: JSON.stringify({ model: id }) })
  }
  function buildMenus() {
    const pm = $('#persona-menu'); pm.innerHTML = ''
    for (const p of state.meta.personas) {
      const b = el('button', 'menu-item' + (p.id === state.persona ? ' active' : ''))
      b.innerHTML = `<span class="mi-icon" style="background:${p.color}22;color:${p.color}"><i class="fas ${p.icon}"></i></span><span><div class="mi-title">${p.nameAr} <span class="text-slate-500 font-normal text-xs">${p.name}</span></div><div class="mi-desc">${p.description}</div></span>`
      b.onclick = () => { setPersona(p.id); closeMenus(); buildMenus() }
      pm.appendChild(b)
    }
    const mm = $('#model-menu'); mm.innerHTML = ''
    if (settings.apiKey && settings.model) {
      const b = el('button', 'menu-item' + (state.model === settings.model ? ' active' : ''))
      b.innerHTML = `<span class="mi-icon bg-emerald-500/10 text-emerald-400"><i class="fas fa-key"></i></span><span><div class="mi-title">${settings.model}</div><div class="mi-desc">نموذجك المخصص (BYOK)</div></span>`
      b.onclick = () => { setModel(settings.model); closeMenus(); buildMenus() }
      mm.appendChild(b)
    }
    for (const m of state.meta.models) {
      const b = el('button', 'menu-item' + (m.id === state.model ? ' active' : ''))
      b.innerHTML = `<span class="mi-icon bg-cyan-500/10 text-cyan-400"><i class="fas fa-microchip"></i></span><span><div class="mi-title">${m.name}</div><div class="mi-desc">${m.desc}</div></span>`
      b.onclick = () => { setModel(m.id); closeMenus(); buildMenus() }
      mm.appendChild(b)
    }
  }
  const closeMenus = () => document.querySelectorAll('.menu').forEach((m) => m.classList.add('hidden'))
  $('#persona-btn').onclick = (e) => { e.stopPropagation(); const m = $('#persona-menu'); const h = m.classList.contains('hidden'); closeMenus(); m.classList.toggle('hidden', !h) }
  $('#model-btn').onclick = (e) => { e.stopPropagation(); const m = $('#model-menu'); const h = m.classList.contains('hidden'); closeMenus(); m.classList.toggle('hidden', !h) }
  document.addEventListener('click', closeMenus)

  // ---------- Suggestions ----------
  const SUGGESTIONS = {
    nova: [
      ['fa-lightbulb', 'اشرح لي فكرة معقدة', 'اشرح لي الحوسبة الكمومية كأني في الثانوية'],
      ['fa-list-check', 'خطة عمل', 'اعمل لي خطة أسبوعية لتعلم الإنجليزية في 30 دقيقة يومياً'],
      ['fa-envelope', 'كتابة رسالة', 'اكتب إيميل احترافي لطلب إجازة من مديري'],
      ['fa-scale-balanced', 'مقارنة', 'قارن بين iPhone و Android في جدول من حيث المميزات'],
    ],
    coder: [
      ['fa-python', 'كود Python', 'اكتب سكريبت Python ينظم الملفات في مجلد حسب النوع'],
      ['fa-bug', 'تصحيح خطأ', 'ليه بيظهر لي TypeError: cannot read property of undefined في JavaScript؟'],
      ['fa-database', 'SQL', 'اكتب query يجيب أعلى 5 عملاء من حيث المبيعات مع شرح'],
      ['fa-globe', 'موقع ويب', 'اعمل لي صفحة Landing Page بـ HTML و Tailwind لتطبيق توصيل'],
    ],
    teacher: [
      ['fa-atom', 'فيزياء', 'اشرح لي النسبية الخاصة بمثال بسيط'],
      ['fa-calculator', 'رياضيات', 'علمني التفاضل من الصفر خطوة بخطوة'],
      ['fa-language', 'لغات', 'اشرح لي الفرق بين Present Perfect و Past Simple'],
      ['fa-landmark', 'تاريخ', 'لخّص لي أسباب الحرب العالمية الأولى'],
    ],
    analyst: [
      ['fa-briefcase', 'قرار عمل', 'أفتح مطعم أو كافيه؟ حلل الخيارين بميزانية 500 ألف جنيه'],
      ['fa-chart-pie', 'تحليل سوق', 'حلل سوق التجارة الإلكترونية في مصر 2026'],
      ['fa-money-bill-trend-up', 'استثمار', 'قارن بين الذهب والعقارات والأسهم كاستثمار طويل المدى'],
      ['fa-diagram-project', 'استراتيجية', 'اعمل SWOT analysis لشركة ناشئة في مجال التعليم الإلكتروني'],
    ],
    creative: [
      ['fa-book-open', 'قصة قصيرة', 'اكتب قصة قصيرة عن روبوت يتعلم الحب'],
      ['fa-bullhorn', 'إعلان', 'اكتب 5 أفكار إعلانات لمشروع عطور جديد'],
      ['fa-music', 'شعر', 'اكتب قصيدة عن القاهرة في الفجر'],
      ['fa-pen-nib', 'محتوى', 'اكتب 10 أفكار لفيديوهات TikTok عن الطبخ'],
    ],
  }
  function renderSuggestions() {
    const box = $('#suggestions'); box.innerHTML = ''
    for (const [icon, title, prompt] of SUGGESTIONS[state.persona] || SUGGESTIONS.nova) {
      const b = el('button', 'suggestion')
      b.innerHTML = `<i class="fas ${icon}"></i><div class="s-title">${title}</div><div class="s-desc">${prompt}</div>`
      b.onclick = () => { $('#composer-input').value = prompt; autoGrow(); send() }
      box.appendChild(b)
    }
  }

  // ---------- Messages ----------
  const msgList = $('#message-list'), welcome = $('#welcome'), messagesBox = $('#messages')
  const scrollBottom = (force) => {
    const nearBottom = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight < 120
    if (force || nearBottom) messagesBox.scrollTop = messagesBox.scrollHeight
  }

  function personaOf(id) { return state.meta.personas.find((p) => p.id === id) || state.meta.personas[0] }

  function addMessage(role, content, opts = {}) {
    const wrap = el('article', `msg ${role}`)
    const p = personaOf(state.current?.persona || state.persona)
    wrap.innerHTML = role === 'user'
      ? `<div class="avatar"><i class="fas fa-user"></i></div><div class="bubble"><div class="meta">أنت</div><div class="content"></div><div class="actions"><button data-a="copy"><i class="far fa-copy"></i> نسخ</button><button data-a="edit"><i class="fas fa-pen"></i> تعديل</button></div></div>`
      : `<div class="avatar"><i class="fas ${p.icon}"></i></div><div class="bubble"><div class="meta">${p.nameAr}</div><div class="content prose-nova"></div><div class="actions"><button data-a="copy"><i class="far fa-copy"></i> نسخ</button><button data-a="regen"><i class="fas fa-rotate"></i> إعادة التوليد</button></div></div>`
    const c = wrap.querySelector('.content')
    if (role === 'user') c.textContent = content
    else c.innerHTML = opts.thinking ? '<div class="thinking"><span></span><span></span><span></span></div>' : md(content)
    wrap.dataset.raw = content
    wrap.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a
      const cp = e.target.closest('[data-copy]')
      if (cp) { navigator.clipboard.writeText(document.getElementById(cp.dataset.copy).innerText); toast('تم نسخ الكود'); return }
      if (a === 'copy') { navigator.clipboard.writeText(wrap.dataset.raw); toast('تم النسخ') }
      if (a === 'regen') regenerate()
      if (a === 'edit') { $('#composer-input').value = wrap.dataset.raw; autoGrow(); $('#composer-input').focus() }
    }
    msgList.appendChild(wrap)
    showChat(); scrollBottom(true)
    return wrap
  }

  function showChat() { welcome.classList.add('hidden'); msgList.classList.remove('hidden'); ['#btn-rename', '#btn-export', '#btn-delete'].forEach((s) => $(s).classList.remove('hidden')) }
  function showWelcome() { welcome.classList.remove('hidden'); msgList.classList.add('hidden'); msgList.innerHTML = ''; ['#btn-rename', '#btn-export', '#btn-delete'].forEach((s) => $(s).classList.add('hidden')) }

  async function loadConversation(id) {
    if (state.streaming) stopStream()
    const conv = await api(`/api/conversations/${id}`)
    state.current = conv
    state.persona = conv.persona; state.model = conv.model
    setPersonaUI(); setModelUI(); buildMenus()
    msgList.innerHTML = ''
    for (const m of conv.messages) addMessage(m.role, m.content)
    showChat(); scrollBottom(true); renderConversations()
    history.replaceState(null, '', `#${id}`)
  }
  function setPersonaUI() { const p = personaOf(state.persona); $('#persona-icon').className = `fas ${p.icon}`; $('#persona-icon').style.color = p.color; $('#persona-name').textContent = p.nameAr }
  function setModelUI() { $('#model-name').textContent = state.meta.models.find((m) => m.id === state.model)?.name || state.model }

  function newChat() {
    if (state.streaming) stopStream()
    state.current = null
    showWelcome(); renderConversations(); renderSuggestions()
    history.replaceState(null, '', '/')
    $('#composer-input').focus()
  }
  $('#btn-new-chat').onclick = () => { newChat(); openSidebar(false) }

  // ---------- Streaming send ----------
  const input = $('#composer-input'), btnSend = $('#btn-send'), btnStop = $('#btn-stop')
  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; btnSend.disabled = !input.value.trim() || state.streaming }
  input.oninput = autoGrow
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } }
  btnSend.onclick = send
  btnStop.onclick = () => stopStream()
  autoGrow()

  function setStreaming(on) { state.streaming = on; btnStop.classList.toggle('hidden', !on); btnSend.classList.toggle('hidden', on); autoGrow() }
  function stopStream() { state.abort?.abort(); state.abort = null; setStreaming(false) }

  async function send() {
    const content = input.value.trim()
    if (!content || state.streaming) return
    input.value = ''; autoGrow()
    addMessage('user', content)
    await streamRequest({ content })
  }
  async function regenerate() {
    if (state.streaming || !state.current) return
    const last = msgList.querySelector('.msg.assistant:last-of-type')
    if (last) last.remove()
    await streamRequest({ regenerate: true })
  }

  async function streamRequest(payload) {
    setStreaming(true)
    const bubble = addMessage('assistant', '', { thinking: true })
    const contentEl = bubble.querySelector('.content')
    let full = '', started = false, rafPending = false
    const paint = () => { rafPending = false; contentEl.innerHTML = md(full); contentEl.classList.add('typing-cursor'); scrollBottom() }

    state.abort = new AbortController()
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...byokHeaders() }, signal: state.abort.signal,
        body: JSON.stringify({ ...payload, conversation_id: state.current?.id, persona: state.persona, model: state.model }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || j.error || 'request failed') }
      const reader = res.body.getReader(), dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const events = buf.split('\n\n'); buf = events.pop()
        for (const ev of events) {
          let type = 'message', data = ''
          for (const line of ev.split('\n')) { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim() }
          if (!data) continue
          const j = JSON.parse(data)
          if (type === 'meta') {
            if (!state.current) { state.current = { id: j.conversation_id, persona: j.persona, model: j.model, title: 'محادثة جديدة' }; history.replaceState(null, '', `#${j.conversation_id}`); refreshConversations() }
          } else if (type === 'delta') {
            full += j.t; started = true
            if (!rafPending) { rafPending = true; requestAnimationFrame(paint) }
          } else if (type === 'error') {
            if (j.conversation_deleted) { state.current = null; history.replaceState(null, '', '/') }
            const e = new Error(j.message); e.code = j.code; throw e
          } else if (type === 'done') {
            if (j.title && state.current) state.current.title = j.title
          }
        }
      }
      contentEl.innerHTML = md(full); contentEl.classList.remove('typing-cursor'); bubble.dataset.raw = full
    } catch (err) {
      if (err.name === 'AbortError') { contentEl.innerHTML = md(full + (full ? '\n\n' : '') + '_⏹ تم الإيقاف_'); bubble.dataset.raw = full }
      else {
        const needsKey = ['provider', 'auth', 'no_api_key'].includes(err.code) || /credit|quota|api key|401|402|403/i.test(err.message)
        const safeMsg = String(err.message).replace(/</g, '&lt;')
        contentEl.innerHTML = `<div class="text-red-300 text-sm space-y-2"><div><i class="fas fa-triangle-exclamation"></i> ${safeMsg}</div>${needsKey ? '<div class="text-slate-400">💡 يمكنك إضافة مفتاح API خاص بك (OpenAI / OpenRouter / Groq / أي مزود متوافق) من <button class="underline text-violet-300" data-a="open-settings">الإعدادات</button> — يُحفظ في متصفحك فقط.</div>' : ''}</div>`
        contentEl.querySelector('[data-a=open-settings]')?.addEventListener('click', () => $('#btn-settings').click())
      }
    } finally {
      contentEl.classList.remove('typing-cursor')
      setStreaming(false); state.abort = null
      refreshConversations(); refreshMemoryCount()
    }
  }

  // ---------- Header actions ----------
  $('#btn-rename').onclick = async () => {
    if (!state.current) return
    const t = prompt('اسم المحادثة:', state.current.title)
    if (!t) return
    await api(`/api/conversations/${state.current.id}`, { method: 'PATCH', body: JSON.stringify({ title: t }) })
    state.current.title = t; refreshConversations(); toast('تم التعديل')
  }
  $('#btn-delete').onclick = () => state.current && deleteConversation(state.current.id)
  $('#btn-export').onclick = () => {
    if (!state.current) return
    const parts = [...msgList.querySelectorAll('.msg')].map((m) => `### ${m.classList.contains('user') ? '👤 أنت' : '✨ NOVA'}\n\n${m.dataset.raw}`)
    const blob = new Blob([`# ${state.current.title}\n\n${parts.join('\n\n---\n\n')}`], { type: 'text/markdown' })
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `${state.current.title}.md`; a.click()
  }

  // ---------- Modal ----------
  const modal = $('#modal')
  const openModal = (title, body) => { $('#modal-title').textContent = title; $('#modal-body').innerHTML = ''; $('#modal-body').append(body); modal.classList.remove('hidden') }
  const closeModal = () => modal.classList.add('hidden')
  $('#modal-close').onclick = closeModal
  modal.onclick = (e) => { if (e.target === modal) closeModal() }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMenus() } })

  async function refreshMemoryCount() { try { const m = await api('/api/memories'); $('#memory-count').textContent = m.length } catch {} }

  $('#btn-memory').onclick = async () => {
    const mems = await api('/api/memories')
    const box = el('div', 'space-y-3')
    box.innerHTML = `<p class="text-sm text-slate-400">NOVA يتذكر هذه الحقائق عنك تلقائياً ويستخدمها في كل محادثة. يمكنك إضافة أو حذف أي منها.</p>`
    const form = el('form', 'flex gap-2')
    form.innerHTML = `<input class="input-dark" placeholder="أضف حقيقة… مثال: اسمي أحمد وأعمل مصمم" required><button class="btn-primary !py-2 !px-4"><i class="fas fa-plus"></i></button>`
    form.onsubmit = async (e) => { e.preventDefault(); await api('/api/memories', { method: 'POST', body: JSON.stringify({ fact: form.querySelector('input').value }) }); $('#btn-memory').click(); refreshMemoryCount() }
    box.appendChild(form)
    const list = el('div', 'space-y-2')
    if (!mems.length) list.innerHTML = `<p class="text-center text-slate-500 text-sm py-6">لا توجد ذكريات بعد — ابدأ محادثة وعرّف NOVA بنفسك.</p>`
    for (const m of mems) {
      const it = el('div', 'memory-item')
      it.innerHTML = `<i class="fas fa-brain text-pink-400 mt-1 text-xs"></i><span></span><button title="حذف"><i class="fas fa-times"></i></button>`
      it.querySelector('span').textContent = m.fact
      it.querySelector('button').onclick = async () => { await api(`/api/memories/${m.id}`, { method: 'DELETE' }); it.remove(); refreshMemoryCount() }
      list.appendChild(it)
    }
    box.appendChild(list)
    if (mems.length) { const clr = el('button', 'text-xs text-red-400 hover:underline', 'مسح كل الذاكرة'); clr.onclick = async () => { if (confirm('مسح كل الذاكرة؟')) { await api('/api/memories', { method: 'DELETE' }); closeModal(); refreshMemoryCount() } }; box.appendChild(clr) }
    openModal('🧠 الذاكرة طويلة المدى', box)
  }

  $('#btn-settings').onclick = () => {
    const box = el('div', 'space-y-4 text-sm')
    box.innerHTML = `
      <p class="text-slate-400">استخدم مفتاح API خاص بك من أي مزود متوافق مع OpenAI. <b class="text-slate-200">المفتاح يُحفظ في متصفحك فقط</b> ولا يُخزَّن على الخادم أبداً.</p>
      <div class="grid gap-3">
        <label class="block"><span class="text-xs text-slate-400 block mb-1">مفتاح API</span><input id="s-key" type="password" class="input-dark mono" dir="ltr" placeholder="sk-..." autocomplete="off"></label>
        <label class="block"><span class="text-xs text-slate-400 block mb-1">Base URL (اختياري)</span><input id="s-base" class="input-dark mono" dir="ltr" placeholder="https://api.openai.com/v1"></label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="text-xs text-slate-400 block mb-1">النموذج الرئيسي</span><input id="s-model" class="input-dark mono" dir="ltr" placeholder="gpt-4o"></label>
          <label class="block"><span class="text-xs text-slate-400 block mb-1">نموذج سريع للعناوين/الذاكرة</span><input id="s-cheap" class="input-dark mono" dir="ltr" placeholder="gpt-4o-mini"></label>
        </div>
      </div>
      <details class="text-xs text-slate-400"><summary class="cursor-pointer text-slate-300">أمثلة لمزودين مجانيين/رخيصين</summary>
        <ul class="list-disc ps-5 mt-2 space-y-1 mono" dir="ltr">
          <li>OpenAI: https://api.openai.com/v1 — gpt-4o-mini</li>
          <li>Groq (free): https://api.groq.com/openai/v1 — llama-3.3-70b-versatile</li>
          <li>OpenRouter: https://openrouter.ai/api/v1 — openai/gpt-4o-mini</li>
          <li>Google Gemini: https://generativelanguage.googleapis.com/v1beta/openai — gemini-2.0-flash</li>
          <li>DeepSeek: https://api.deepseek.com/v1 — deepseek-chat</li>
        </ul></details>
      <div class="flex gap-2 justify-end"><button id="s-clear" class="chip hover:text-red-300">مسح</button><button id="s-save" class="btn-primary !py-2 !px-5"><i class="fas fa-check"></i> حفظ</button></div>`
    box.querySelector('#s-key').value = settings.apiKey; box.querySelector('#s-base').value = settings.baseUrl; box.querySelector('#s-model').value = settings.model; box.querySelector('#s-cheap').value = settings.cheapModel
    box.querySelector('#s-save').onclick = () => {
      settings.apiKey = box.querySelector('#s-key').value.trim(); settings.baseUrl = box.querySelector('#s-base').value.trim().replace(/\/$/, '')
      settings.model = box.querySelector('#s-model').value.trim(); settings.cheapModel = box.querySelector('#s-cheap').value.trim()
      saveSettings(); if (settings.apiKey && settings.model) setModel(settings.model); buildMenus(); updateKeyStatus(); closeModal(); toast('تم حفظ الإعدادات')
    }
    box.querySelector('#s-clear').onclick = () => { Object.assign(settings, { apiKey: '', baseUrl: '', model: '', cheapModel: '' }); saveSettings(); state.model = state.meta.defaults.model; setModelUI(); buildMenus(); updateKeyStatus(); closeModal(); toast('تم المسح') }
    openModal('⚙️ الإعدادات و مفتاح API', box)
  }

  $('#btn-stats').onclick = async () => {
    const { stats } = await api('/api/meta')
    const box = el('div', 'grid grid-cols-2 gap-3')
    const cards = [['fa-comments', stats.conversations, 'محادثة', '#8b5cf6'], ['fa-message', stats.total_messages, 'رسالة', '#06b6d4'], ['fa-coins', stats.total_tokens.toLocaleString(), 'توكن تقريبي', '#f59e0b'], ['fa-brain', stats.memories, 'ذكرى محفوظة', '#ec4899']]
    for (const [i, v, l, c] of cards) box.appendChild(el('div', 'stat-card', `<i class="fas ${i} mb-2" style="color:${c}"></i><div class="v">${v}</div><div class="l">${l}</div>`))
    openModal('📊 إحصائياتك', box)
  }

  $('#btn-about').onclick = () => {
    const box = el('div', 'prose-nova text-sm')
    box.innerHTML = md(`**NOVA** منصة ذكاء اصطناعي متقدمة مبنية على أحدث التقنيات:

- ⚡ **Hono + TypeScript** على Cloudflare Edge — استجابة فورية من أقرب نقطة لك
- 🗄️ **Cloudflare D1** — محادثاتك وذاكرتك محفوظة بأمان
- 🧠 **ذاكرة طويلة المدى** — يتعلم عنك تلقائياً ويتذكر في كل محادثة
- 🎭 **5 شخصيات** — نوفا، المبرمج، المعلم، المحلل، المبدع
- 🚀 **4 نماذج LLM** — من الأسرع إلى الأقوى
- 📝 **Markdown + تلوين الكود** مع نسخ بضغطة واحدة
- 🔄 **Streaming** — الرد يظهر لحظياً كلمة بكلمة

لا يحتاج تسجيل: هويتك محفوظة في متصفحك تلقائياً.`)
    openModal('✨ عن NOVA', box)
  }

  // ---------- Init ----------
  ;(async () => {
    state.meta = await api('/api/meta')
    state.persona = state.meta.defaults.persona; state.model = (settings.apiKey && settings.model) ? settings.model : state.meta.defaults.model
    setPersonaUI(); setModelUI(); buildMenus(); renderSuggestions(); updateKeyStatus()
    if (!settings.apiKey && !state.meta.server_key_configured) setTimeout(() => $('#btn-settings').click(), 600)
    $('#memory-count').textContent = state.meta.stats.memories
    await refreshConversations()
    const hash = location.hash.slice(1)
    if (hash && state.conversations.some((c) => c.id === hash)) loadConversation(hash)
    input.focus()
  })().catch((e) => toast('خطأ في التحميل: ' + e.message))
})()
