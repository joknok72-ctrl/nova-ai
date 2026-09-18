/* NOVA CODE frontend v2 — part 2: messages, files, preview, streaming, settings */
;(() => {
  const N = window.N
  const { $, el, esc, state, settings, saveSettings, usingByok, byokHeaders, detectOS, md, toast, api, openSidebar, renderConversations, refreshConversations, deleteConversation, currentModels, setModelUI, closeMenus, refreshModels, updateKeyStatus, renderSuggestions } = N

  // ---------- Messages ----------
  const msgList = $('#message-list'), welcome = $('#welcome'), messagesBox = $('#messages')
  const scrollBottom = (force) => { const near = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight < 140; if (force || near) messagesBox.scrollTop = messagesBox.scrollHeight }

  function addMessage(role, content, opts = {}) {
    const wrap = el('article', `msg ${role}`)
    wrap.innerHTML = role === 'user'
      ? `<div class="avatar"><i class="fas fa-user"></i></div><div class="bubble"><div class="meta">أنت</div><div class="content"></div><div class="actions"><button data-a="copy"><i class="far fa-copy"></i> نسخ</button><button data-a="edit"><i class="fas fa-pen"></i> تعديل وإعادة إرسال</button></div></div>`
      : `<div class="avatar"><i class="fas fa-code"></i></div><div class="bubble"><div class="meta">NOVA CODE <span class="mono opacity-60" dir="ltr">${esc(opts.model || state.model)}</span></div><div class="content prose-nova"></div><div class="actions"><button data-a="copy"><i class="far fa-copy"></i> نسخ</button><button data-a="regen"><i class="fas fa-rotate"></i> إعادة التوليد</button><button data-a="continue"><i class="fas fa-forward"></i> كمّل</button></div></div>`
    const c = wrap.querySelector('.content')
    if (role === 'user') c.textContent = content.length > 3000 ? content.slice(0, 3000) + '\n… (' + content.length.toLocaleString() + ' حرف)' : content
    else c.innerHTML = opts.thinking ? '<div class="thinking"><span></span><span></span><span></span></div>' : md(content)
    wrap.dataset.raw = content
    wrap.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a
      const cp = e.target.closest('[data-copy]'), dl = e.target.closest('[data-dl]'), pv = e.target.closest('[data-preview]')
      if (cp) { navigator.clipboard.writeText(document.getElementById(cp.dataset.copy).innerText); toast('تم نسخ الكود'); return }
      if (dl) { const code = document.getElementById(dl.dataset.dl); downloadText(guessFilename(code), code.innerText); return }
      if (pv) { const code = document.getElementById(pv.dataset.preview); openPreviewWith(code.innerText); return }
      if (a === 'copy') { navigator.clipboard.writeText(wrap.dataset.raw); toast('تم النسخ') }
      if (a === 'regen') regenerate()
      if (a === 'continue') { input.value = 'كمّل'; send() }
      if (a === 'edit') { input.value = wrap.dataset.raw; autoGrow(); input.focus() }
    }
    msgList.appendChild(wrap)
    showChat(); scrollBottom(true)
    return wrap
  }
  const guessFilename = (code) => { const lang = code.dataset.lang || 'txt'; const map = { javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css', json: 'json', bash: 'sh', shell: 'sh', sql: 'sql', yaml: 'yml', markdown: 'md', dockerfile: 'Dockerfile', tsx: 'tsx', jsx: 'jsx' }; return 'file.' + (map[lang] || lang || 'txt') }
  const downloadText = (name, text) => { const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) }

  function showChat() { welcome.classList.add('hidden'); msgList.classList.remove('hidden'); ['#btn-rename', '#btn-export', '#btn-delete'].forEach((s) => $(s).classList.remove('hidden')); updateFilesButton() }
  function showWelcome() { welcome.classList.remove('hidden'); msgList.classList.add('hidden'); msgList.innerHTML = ''; ['#btn-rename', '#btn-export', '#btn-delete', '#btn-files'].forEach((s) => $(s).classList.add('hidden')); closeFiles() }

  async function loadConversation(id) {
    if (state.streaming) stopStream()
    const conv = await N.store.getConversation(id); if (!conv) return newChat()
    conv.messages = await N.store.listMessages(id)
    state.current = conv
    if (conv.model && currentModels().some((m) => m.id === conv.model)) { state.model = conv.model; setModelUI() }
    msgList.innerHTML = ''; state.files = {}
    for (const m of conv.messages) { addMessage(m.role, m.content); if (m.role === 'assistant') extractFiles(m.content) }
    showChat(); scrollBottom(true); renderConversations(); updateFilesButton()
    history.replaceState(null, '', `#${id}`)
  }
  function newChat() { if (state.streaming) stopStream(); state.current = null; state.files = {}; showWelcome(); renderConversations(); history.replaceState(null, '', '/'); input.focus() }
  $('#btn-new-chat').onclick = () => { newChat(); openSidebar(false) }

  // ---------- Project files extraction ----------
  function extractFiles(text) {
    // Sequential fence parser: for each ```block```, look at the 1-3 non-empty lines right before it for a file path,
    // else at the first line inside the block for a path comment.
    const FILE = /^(?:#{1,6}\s*|\*\*|📄\s*)?[`"']?((?:[\w@.\-]+\/)*(?:[\w@.\-]+\.[a-zA-Z0-9]{1,12}|Dockerfile|Makefile|\.env\.example|\.gitignore|\.env))[`"']?(?:\*\*)?\s*:?\s*$/
    const SKIP = /\.(png|jpe?g|gif|svg|ico|woff2?|ttf|mp3|mp4|zip|pdf)$/i
    const fence = /```([\w+.-]*)\n([\s\S]*?)```/g
    let m, n = 0
    while ((m = fence.exec(text))) {
      const before = text.slice(0, m.index).split('\n').filter((l) => l.trim()).slice(-2)
      let path = null
      for (let i = before.length - 1; i >= 0 && !path; i--) { const h = before[i].trim().match(FILE); if (h) path = h[1] }
      let body = m[2]
      if (!path) {
        const first = body.split('\n')[0] || ''
        const c = first.match(/^(?:\/\/|#|<!--|--|\/\*)\s*(?:file:|path:)?\s*((?:[\w@.\-]+\/)*[\w@.\-]+\.[a-zA-Z0-9]{1,12})\s*(?:-->|\*\/)?\s*$/)
        if (c) { path = c[1]; body = body.split('\n').slice(1).join('\n') }
      }
      if (!path) continue
      path = path.replace(/^\.\//, '')
      if (/^(https?:|www\.)/.test(path) || path.length > 120 || SKIP.test(path)) continue
      if (!m[1] && body.trim().split('\n').every((l) => /^[\w@.\-\/│├└─\s]+$/.test(l)) && body.split('\n').length > 1 && !/[;{}=<>()]/.test(body)) continue // looks like a file tree
      state.files[path] = body.replace(/\n$/, ''); n++
    }
    return n
  }
  function updateFilesButton() {
    const n = Object.keys(state.files).length
    $('#files-count').textContent = n
    $('#btn-files').classList.toggle('hidden', n === 0)
    if (!$('#files-panel').classList.contains('hidden')) renderFileTree()
  }
  const langOf = (p) => { const e = p.split('.').pop().toLowerCase(); return { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', py: 'python', html: 'xml', htm: 'xml', vue: 'xml', svelte: 'xml', xml: 'xml', css: 'css', scss: 'scss', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', env: 'bash', sql: 'sql', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', dart: 'dart', php: 'php', rb: 'ruby', c: 'c', cpp: 'cpp', h: 'c', cs: 'csharp', swift: 'swift' }[e] || (p === 'Dockerfile' ? 'dockerfile' : 'plaintext') }
  const iconOf = (p) => { const e = p.split('.').pop().toLowerCase(); return { js: 'fa-brands fa-js', ts: 'fa-solid fa-code', tsx: 'fa-brands fa-react', jsx: 'fa-brands fa-react', py: 'fa-brands fa-python', html: 'fa-brands fa-html5', css: 'fa-brands fa-css3-alt', json: 'fa-solid fa-code', md: 'fa-brands fa-markdown', sql: 'fa-solid fa-database', yml: 'fa-solid fa-gear', yaml: 'fa-solid fa-gear', sh: 'fa-solid fa-terminal' }[e] || (p === 'Dockerfile' ? 'fa-brands fa-docker' : 'fa-regular fa-file-code') }

  function renderFileTree() {
    const tree = $('#file-tree'); tree.innerHTML = ''
    const paths = Object.keys(state.files).sort()
    if (!state.activeFile || !state.files[state.activeFile]) state.activeFile = paths.find((p) => /index\.html$/.test(p)) || paths[0]
    let lastDir = null
    for (const p of paths) {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
      if (dir !== lastDir) { if (dir) tree.appendChild(el('div', 'ft-dir', `<i class="fas fa-folder text-amber-400/70"></i><span dir="ltr">${esc(dir)}/</span>`)); lastDir = dir }
      const f = el('div', 'ft-file' + (p === state.activeFile ? ' active' : ''), `<i class="${iconOf(p)}"></i><span>${esc(p.split('/').pop())}</span>`)
      f.title = p; f.onclick = () => { state.activeFile = p; renderFileTree() }
      tree.appendChild(f)
    }
    showFile(state.activeFile)
    const sel = $('#preview-file'); sel.innerHTML = ''
    for (const h of paths.filter((p) => /\.html?$/.test(p))) { const o = el('option'); o.value = h; o.textContent = h; sel.appendChild(o) }
  }
  function showFile(p) {
    if (!p) return
    const code = $('#file-view code'); const content = state.files[p] || ''
    $('#file-head').innerHTML = `<i class="${iconOf(p)}"></i><span class="flex-1 truncate">${esc(p)}</span><span>${content.split('\n').length} lines</span><button class="icon-btn !w-7 !h-7" id="fv-copy" title="Copy"><i class="far fa-copy"></i></button><button class="icon-btn !w-7 !h-7" id="fv-dl" title="Download"><i class="fas fa-download"></i></button>`
    try { code.innerHTML = hljs.highlight(content, { language: langOf(p) }).value } catch { code.textContent = content }
    $('#fv-copy').onclick = () => { navigator.clipboard.writeText(content); toast('تم النسخ') }
    $('#fv-dl').onclick = () => downloadText(p.split('/').pop(), content)
  }
  function buildPreviewHtml(entry) {
    let html = state.files[entry] || ''
    const base = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : ''
    const resolve = (ref) => { ref = ref.replace(/^\.\//, '').replace(/^\//, ''); return state.files[base + ref] ?? state.files[ref] ?? state.files[Object.keys(state.files).find((k) => k.endsWith('/' + ref)) ?? ''] }
    html = html.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (tag, href) => { if (/^https?:|^\/\//.test(href)) return tag; const css = resolve(href); return css !== undefined ? `<style>\n${css}\n</style>` : tag })
    html = html.replace(/<script([^>]*)src=["']([^"']+\.m?js)["']([^>]*)><\/script>/gi, (tag, a, src, b) => { if (/^https?:|^\/\//.test(src)) return tag; const js = resolve(src); return js !== undefined ? `<script${a}${b}>\n${js.replace(/<\/script>/gi, '<\\/script>')}\n</script>` : tag })
    return html
  }
  let previewRaw = null
  function renderPreview() {
    const entry = $('#preview-file').value
    $('#preview-frame').srcdoc = previewRaw ?? (entry ? buildPreviewHtml(entry) : '<p style="font-family:sans-serif;padding:20px;direction:rtl">لا يوجد ملف HTML للمعاينة — المعاينة تعمل للمواقع فقط</p>')
  }
  function openPreviewWith(html) { previewRaw = html; openFiles('preview') }
  function openFiles(tab = 'files') { $('#files-panel').classList.remove('hidden'); renderFileTree(); switchTab(tab) }
  function closeFiles() { $('#files-panel').classList.add('hidden'); previewRaw = null }
  function switchTab(t) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t))
    $('#tab-files').classList.toggle('hidden', t !== 'files'); $('#tab-files').classList.toggle('flex', t === 'files')
    $('#tab-preview').classList.toggle('hidden', t !== 'preview'); $('#tab-preview').classList.toggle('flex', t === 'preview')
    if (t === 'preview') renderPreview()
  }
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => { previewRaw = null; switchTab(b.dataset.tab) }))
  $('#btn-files').onclick = () => openFiles('files')
  $('#btn-close-files').onclick = closeFiles
  $('#preview-file').onchange = () => { previewRaw = null; renderPreview() }
  $('#btn-preview-refresh').onclick = () => renderPreview()
  $('#btn-preview-open').onclick = () => { const blob = new Blob([$('#preview-frame').srcdoc || ''], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank') }
  $('#btn-zip').onclick = async () => {
    const zip = new JSZip(); const paths = Object.keys(state.files)
    if (!paths.length) return toast('لا توجد ملفات')
    for (const p of paths) zip.file(p, state.files[p])
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = ((state.current?.title || 'project').replace(/[^\w\u0600-\u06FF -]/g, '').trim() || 'project') + '.zip'; a.click()
    toast(`تم تنزيل ${paths.length} ملف`)
  }

  // ---------- Attachments ----------
  $('#btn-attach').onclick = () => $('#file-input').click()
  $('#file-input').onchange = async (e) => {
    for (const f of e.target.files) {
      if (f.size > 400000) { toast(`${f.name} كبير جداً (الحد 400KB)`); continue }
      state.attachments.push({ name: f.name, content: await f.text() })
    }
    e.target.value = ''; renderAttachments(); autoGrow()
  }
  function renderAttachments() {
    const box = $('#attachments'); box.innerHTML = ''
    state.attachments.forEach((a, i) => { const c = el('span', 'attachment', `<i class="far fa-file-code"></i>${esc(a.name)} <span class="opacity-50">${(a.content.length / 1024).toFixed(1)}KB</span><button title="إزالة"><i class="fas fa-times"></i></button>`); c.querySelector('button').onclick = () => { state.attachments.splice(i, 1); renderAttachments(); autoGrow() }; box.appendChild(c) })
  }
  document.addEventListener('paste', (e) => {
    if (document.activeElement !== input) return
    const t = e.clipboardData.getData('text')
    if (t.length > 6000) { e.preventDefault(); state.attachments.push({ name: `pasted-${state.attachments.length + 1}.txt`, content: t }); renderAttachments(); autoGrow(); toast('تم إرفاق النص الطويل كملف') }
  })

  // ---------- Streaming ----------
  const input = $('#composer-input'), btnSend = $('#btn-send'), btnStop = $('#btn-stop')
  const DEFAULT_STATUS = 'Enter للإرسال · Shift+Enter لسطر جديد · لو توقف الرد اكتب «كمّل»'
  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; btnSend.disabled = (!input.value.trim() && !state.attachments.length) || state.streaming }
  input.oninput = autoGrow
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } }
  btnSend.onclick = send; btnStop.onclick = () => stopStream(); autoGrow()
  function setStreaming(on) { state.streaming = on; btnStop.classList.toggle('hidden', !on); btnSend.classList.toggle('hidden', on); autoGrow() }
  function stopStream() { state.abort?.abort(); state.abort = null; setStreaming(false) }

  async function send() {
    const content = input.value.trim()
    if ((!content && !state.attachments.length) || state.streaming) return
    if (!navigator.onLine) return toast('لا يوجد إنترنت — إرسال الرسالة للنموذج يحتاج اتصالاً بسيطاً (بضع كيلوبايت)', 3500)
    if (!usingByok() && !state.meta.server_key_configured) return openSettings()
    const attachments = state.attachments; state.attachments = []; renderAttachments()
    input.value = ''; autoGrow()
    let text = content
    if (attachments.length) text = (content || 'Here are my files:') + attachments.map((a) => `\n\n### 📎 ${a.name}\n\`\`\`${(a.name.split('.').pop() || '').slice(0, 12)}\n${a.content}\n\`\`\``).join('')
    if (!state.current) { state.current = await N.store.createConversation(state.model); history.replaceState(null, '', `#${state.current.id}`); refreshConversations() }
    const id = await N.store.addMessage(state.current.id, 'user', text)
    addMessage('user', text)
    await streamRequest({ userMsgId: id })
  }
  async function regenerate() {
    if (state.streaming || !state.current) return
    const msgs = await N.store.listMessages(state.current.id)
    const lastA = [...msgs].reverse().find((m) => m.role === 'assistant')
    if (lastA) await N.store.deleteMessagesFrom(state.current.id, lastA.id)
    const last = msgList.querySelector('.msg.assistant:last-of-type'); if (last) last.remove()
    await streamRequest({ regenerate: true })
  }

  async function streamRequest(payload) {
    setStreaming(true)
    const bubble = addMessage('assistant', '', { thinking: true })
    const contentEl = bubble.querySelector('.content')
    let full = '', raf = false, lastPaint = 0, doneInfo = null
    const paint = () => { raf = false; lastPaint = performance.now(); contentEl.innerHTML = md(full); contentEl.classList.add('typing-cursor'); scrollBottom() }
    const schedule = () => { if (raf) return; raf = true; setTimeout(() => requestAnimationFrame(paint), Math.max(0, 90 - (performance.now() - lastPaint))) }
    $('#status-line').textContent = 'NOVA يفكر ويكتب…'
    state.abort = new AbortController()
    const convId = state.current.id
    const msgs = await N.store.listMessages(convId)
    const memories = (await N.store.listMemories()).map((m) => m.fact)
    const isFirst = msgs.filter((m) => m.role === 'user').length === 1
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...byokHeaders() }, signal: state.abort.signal,
        body: JSON.stringify({ messages: msgs.map((m) => ({ role: m.role, content: m.content })), memories, model: state.model, os: detectOS(), want_title: isFirst && !payload.regenerate, want_facts: !payload.regenerate }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); const e = new Error(j.message || j.error || 'request failed'); e.code = j.error; throw e }
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const events = buf.split('\n\n'); buf = events.pop()
        for (const ev of events) {
          let type = 'message', data = ''
          for (const line of ev.split('\n')) { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim() }
          if (!data) continue
          const j = JSON.parse(data)
          if (type === 'meta') { /* stateless server */ }
          else if (type === 'delta') { full += j.t; schedule() }
          else if (type === 'status') { $('#status-line').textContent = `الرد طويل — NOVA يكمل تلقائياً (جزء ${j.pass + 1})…` }
          else if (type === 'error') { const e = new Error(j.message); e.code = j.code; throw e }
          else if (type === 'done') { doneInfo = j }
        }
      }
      contentEl.innerHTML = md(full); bubble.dataset.raw = full
      // persist locally
      await N.store.addMessage(convId, 'assistant', full, doneInfo?.tokens || 0)
      await N.store.bumpUsage((doneInfo?.tokens || 0))
      if (doneInfo?.title && state.current) { state.current.title = doneInfo.title; await N.store.updateConversation(convId, { title: doneInfo.title }) }
      for (const f of doneInfo?.facts || []) await N.store.addMemory(f)
      const n = extractFiles(full); updateFilesButton()
      if (n > 0 && $('#files-panel').classList.contains('hidden') && window.innerWidth >= 1024) { openFiles(Object.keys(state.files).some((p) => /\.html?$/.test(p)) ? 'preview' : 'files'); toast(`تم استخراج ${Object.keys(state.files).length} ملف — يمكنك تنزيلها ZIP`) }
    } catch (err) {
      if (full) await N.store.addMessage(convId, 'assistant', full).catch(() => {})
      if (err.name === 'AbortError') { contentEl.innerHTML = md(full + (full ? '\n\n' : '') + '_⏹ تم الإيقاف_'); bubble.dataset.raw = full }
      else {
        const needsKey = ['provider', 'auth', 'billing', 'no_api_key', 'rate_limit', 'model'].includes(err.code) || /credit|quota|api key|401|402|403|429/i.test(err.message)
        contentEl.innerHTML = `${full ? md(full) + '<hr>' : ''}<div class="text-red-300 text-sm space-y-2"><div><i class="fas fa-triangle-exclamation"></i> ${esc(err.message)}</div>${needsKey ? `<div class="text-slate-400">💡 ${err.code === 'rate_limit' ? 'انتظر دقيقة أو بدّل النموذج من الأعلى.' : 'أضف/غيّر مفتاح API من'} <button class="underline text-violet-300" data-a="open-settings">الإعدادات</button> — مجاني عبر Google AI Studio أو Groq.</div>` : ''}</div>`
        contentEl.querySelector('[data-a=open-settings]')?.addEventListener('click', (e) => { e.stopPropagation(); openSettings() })
        if (full) bubble.dataset.raw = full
        else if (payload.userMsgId) { await N.store.deleteMessagesFrom(convId, payload.userMsgId).catch(() => {}); const remaining = await N.store.listMessages(convId); if (!remaining.length) { await N.store.deleteConversation(convId); state.current = null; history.replaceState(null, '', '/') } }
      }
    } finally {
      contentEl.classList.remove('typing-cursor'); setStreaming(false); state.abort = null
      $('#status-line').textContent = DEFAULT_STATUS
      refreshConversations(); refreshMemoryCount()
    }
  }

  // ---------- Header actions ----------
  $('#btn-rename').onclick = async () => { if (!state.current) return; const t = prompt('اسم المشروع:', state.current.title); if (!t) return; await N.store.updateConversation(state.current.id, { title: t }); state.current.title = t; refreshConversations(); toast('تم التعديل') }
  $('#btn-delete').onclick = () => state.current && deleteConversation(state.current.id)
  $('#btn-export').onclick = () => { if (!state.current) return; const parts = [...msgList.querySelectorAll('.msg')].map((m) => `### ${m.classList.contains('user') ? '👤 أنت' : '⚡ NOVA CODE'}\n\n${m.dataset.raw}`); downloadText(`${state.current.title}.md`, `# ${state.current.title}\n\n${parts.join('\n\n---\n\n')}`) }

  // ---------- Modal ----------
  const modal = $('#modal')
  const openModal = (title, body) => { $('#modal-title').textContent = title; $('#modal-body').innerHTML = ''; $('#modal-body').append(body); modal.classList.remove('hidden') }
  const closeModal = () => modal.classList.add('hidden')
  $('#modal-close').onclick = closeModal
  modal.onclick = (e) => { if (e.target === modal) closeModal() }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMenus() } })
  async function refreshMemoryCount() { try { const m = await N.store.listMemories(); $('#memory-count').textContent = m.length } catch {} }

  // ---------- Settings / Provider ----------
  function openSettings() {
    const P = state.meta.providers
    const box = el('div', 'space-y-4 text-sm')
    box.innerHTML = `
      <p class="text-slate-400 leading-relaxed">اختر المزود وضع مفتاحك — <b class="text-slate-200">المفتاح يُحفظ في متصفحك فقط</b>. سيتم جلب <b class="text-emerald-300">كل النماذج المتاحة لحسابك</b> تلقائياً (حتى الجديدة).</p>
      <div id="prov-list" class="grid gap-2"></div>
      <div id="prov-form" class="space-y-3 pt-1">
        <div class="flex items-center justify-between"><span class="text-xs text-slate-400">مفتاح API</span><a id="key-link" target="_blank" class="text-xs text-violet-300 hover:underline hidden"><i class="fas fa-up-right-from-square"></i> احصل على مفتاح من هنا</a></div>
        <input id="s-key" type="password" class="input-dark mono" dir="ltr" placeholder="AIza... / sk-... / gsk_..." autocomplete="off">
        <div id="custom-base" class="hidden"><span class="text-xs text-slate-400 block mb-1">Base URL</span><input id="s-base" class="input-dark mono" dir="ltr" placeholder="http://localhost:11434/v1"></div>
        <div id="disc-result" class="text-xs"></div>
        <div class="flex gap-2 justify-end pt-1"><button id="s-clear" class="chip hover:text-red-300">مسح</button><button id="s-save" class="btn-primary !py-2 !px-5"><i class="fas fa-plug"></i> اتصال وجلب النماذج</button></div>
      </div>`
    let chosen = P.find((p) => p.id === (settings.provider || 'gemini')) || P[0]
    const list = box.querySelector('#prov-list')
    const icons = { gemini: 'fa-brands fa-google text-blue-400', openai: 'fas fa-brain text-emerald-400', anthropic: 'fas fa-a text-orange-400', groq: 'fas fa-bolt text-amber-400', openrouter: 'fas fa-route text-violet-400', deepseek: 'fas fa-water text-sky-400', mistral: 'fas fa-wind text-orange-300', together: 'fas fa-people-group text-pink-400', xai: 'fas fa-x text-slate-300', custom: 'fas fa-server text-slate-400' }
    const renderProv = () => {
      list.innerHTML = ''
      for (const p of P) {
        const c = el('button', 'provider-card' + (p.id === chosen.id ? ' active' : ''))
        c.innerHTML = `<i class="${icons[p.id] || 'fas fa-server'} w-4 text-center"></i><span class="min-w-0"><div class="pc-name">${esc(p.name)}</div><div class="pc-note">${esc(p.note)}</div></span>${p.free ? '<span class="free-badge">مجاني</span>' : ''}`
        c.onclick = () => { chosen = p; renderProv(); syncForm() }
        list.appendChild(c)
      }
    }
    const syncForm = () => {
      const link = box.querySelector('#key-link'); link.classList.toggle('hidden', !chosen.keyUrl); link.href = chosen.keyUrl
      box.querySelector('#custom-base').classList.toggle('hidden', chosen.id !== 'custom')
      box.querySelector('#s-key').value = settings.provider === chosen.id ? settings.apiKey : ''
      box.querySelector('#s-base').value = settings.provider === chosen.id ? settings.baseUrl : ''
      box.querySelector('#disc-result').innerHTML = settings.provider === chosen.id && settings.models?.length ? `<span class="text-emerald-300"><i class="fas fa-check"></i> متصل — ${settings.models.length} نموذج · المختار: <span class="mono" dir="ltr">${esc(settings.model)}</span></span>` : ''
    }
    renderProv(); syncForm()
    box.querySelector('#s-save').onclick = async (e) => {
      const key = box.querySelector('#s-key').value.trim(); const base = chosen.id === 'custom' ? box.querySelector('#s-base').value.trim().replace(/\/$/, '') : chosen.baseUrl
      if (!key) return toast('ضع مفتاح API أولاً'); if (!base) return toast('ضع Base URL')
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الاتصال…'
      const res = box.querySelector('#disc-result'); res.innerHTML = ''
      const prev = { ...settings }
      Object.assign(settings, { provider: chosen.id, apiKey: key, baseUrl: base, models: null, model: '' })
      try {
        const r = await refreshModels(false)
        res.innerHTML = `<span class="text-emerald-300"><i class="fas fa-check"></i> تم! ${r.models.length} نموذج متاح · تم اختيار الأفضل للبرمجة: <span class="mono" dir="ltr">${esc(settings.model)}</span></span>`
        setModelUI(); updateKeyStatus(); toast(`متصل بـ ${chosen.name} — ${r.models.length} نموذج`, 3500)
        setTimeout(closeModal, 900)
      } catch (err) {
        Object.assign(settings, prev); saveSettings()
        res.innerHTML = `<span class="text-red-300"><i class="fas fa-triangle-exclamation"></i> ${esc(err.message)}</span>`
      } finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plug"></i> اتصال وجلب النماذج' }
    }
    box.querySelector('#s-clear').onclick = () => { Object.assign(settings, { provider: '', apiKey: '', baseUrl: '', model: '', cheapModel: '', models: null }); saveSettings(); state.model = state.meta.defaults.model; setModelUI(); updateKeyStatus(); closeModal(); toast('تم المسح') }
    openModal('🔑 المزود و مفتاح API', box)
  }
  $('#btn-settings').onclick = openSettings

  $('#btn-memory').onclick = async () => {
    const mems = await N.store.listMemories()
    const box = el('div', 'space-y-3')
    box.innerHTML = `<p class="text-sm text-slate-400">NOVA يتذكر هذه الحقائق تلقائياً (نظامك، مستواك، مشاريعك، الأدوات التي تستخدمها) ويستخدمها في كل مشروع.</p>`
    const form = el('form', 'flex gap-2'); form.innerHTML = `<input class="input-dark" placeholder="أضف حقيقة… مثال: أستخدم Windows 11 ومبتدئ" required><button class="btn-primary !py-2 !px-4"><i class="fas fa-plus"></i></button>`
    form.onsubmit = async (e) => { e.preventDefault(); await N.store.addMemory(form.querySelector('input').value); $('#btn-memory').click(); refreshMemoryCount() }
    box.appendChild(form)
    const list = el('div', 'space-y-2')
    if (!mems.length) list.innerHTML = `<p class="text-center text-slate-500 text-sm py-6">لا توجد ذكريات بعد — ابدأ مشروعاً وعرّف NOVA بنفسك.</p>`
    for (const m of mems) { const it = el('div', 'memory-item', `<i class="fas fa-brain text-pink-400 mt-1 text-xs"></i><span></span><button title="حذف"><i class="fas fa-times"></i></button>`); it.querySelector('span').textContent = m.fact; it.querySelector('button').onclick = async () => { await N.store.deleteMemory(m.id); it.remove(); refreshMemoryCount() }; list.appendChild(it) }
    box.appendChild(list)
    if (mems.length) { const clr = el('button', 'text-xs text-red-400 hover:underline', 'مسح كل الذاكرة'); clr.onclick = async () => { if (confirm('مسح كل الذاكرة؟')) { await N.store.clearMemories(); closeModal(); refreshMemoryCount() } }; box.appendChild(clr) }
    openModal('🧠 الذاكرة طويلة المدى', box)
  }
  $('#btn-backup').onclick = () => {
    const box = el('div', 'space-y-4 text-sm')
    box.innerHTML = `<p class="text-slate-400 leading-relaxed">كل بياناتك (المشاريع، الرسائل، الذاكرة، الإعدادات) محفوظة <b class="text-slate-200">على جهازك فقط</b> ولا تُرسل لأي خادم. صدّرها كملف لتنقلها لجهاز آخر أو للاحتفاظ بنسخة.</p>
      <div class="grid grid-cols-2 gap-3">
        <button id="bk-export" class="btn-primary"><i class="fas fa-file-export"></i> تصدير كل البيانات</button>
        <button id="bk-import" class="chip justify-center !py-3"><i class="fas fa-file-import"></i> استيراد من ملف</button>
      </div>
      <input id="bk-file" type="file" accept="application/json,.json" class="hidden">
      <details class="text-xs text-slate-500"><summary class="cursor-pointer">خيارات متقدمة</summary><button id="bk-wipe" class="mt-2 text-red-400 hover:underline">مسح كل البيانات من هذا الجهاز</button></details>`
    box.querySelector('#bk-export').onclick = async () => { const data = await N.store.exportAll(); downloadText(`nova-code-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data)); toast('تم تصدير النسخة الاحتياطية') }
    box.querySelector('#bk-import').onclick = () => box.querySelector('#bk-file').click()
    box.querySelector('#bk-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await N.store.importAll(JSON.parse(await f.text())); toast('تم الاستيراد بنجاح'); closeModal(); location.reload() } catch (err) { toast('فشل الاستيراد: ' + err.message, 4000) } }
    box.querySelector('#bk-wipe').onclick = async () => { if (confirm('مسح كل المشاريع والذاكرة من هذا الجهاز نهائياً؟')) { await N.store.wipe(); localStorage.removeItem('nova_settings'); location.reload() } }
    openModal('💾 النسخة الاحتياطية', box)
  }
  $('#btn-stats').onclick = async () => {
    const stats = await N.store.stats()
    const box = el('div', 'grid grid-cols-2 gap-3')
    for (const [i, v, l, c] of [['fa-folder-tree', stats.conversations, 'مشروع', '#8b5cf6'], ['fa-message', stats.total_messages, 'رسالة', '#06b6d4'], ['fa-coins', Number(stats.total_tokens).toLocaleString(), 'توكن تقريبي', '#f59e0b'], ['fa-brain', stats.memories, 'ذكرى محفوظة', '#ec4899']]) box.appendChild(el('div', 'stat-card', `<i class="fas ${i} mb-2" style="color:${c}"></i><div class="v">${v}</div><div class="l">${l}</div>`))
    openModal('📊 إحصائياتك', box)
  }
  $('#btn-about').onclick = () => {
    const box = el('div', 'prose-nova text-sm')
    box.innerHTML = md(`**NOVA CODE** مهندس برمجيات بالذكاء الاصطناعي — أنت تقول ماذا تريد، وهو يقرر كل شيء تقني ويبنيه:

- ⚡ **وضع تلقائي ذكي** — يحدد بنفسه: بناء / إصلاح / مراجعة / تصميم معماري / شرح / نشر
- 📦 **مشاريع كاملة** — كل الملفات قابلة للتشغيل، بدون placeholders، مع خطوات للمبتدئين
- 🗂️ **مستعرض ملفات المشروع** + **معاينة حية** للمواقع + **تنزيل ZIP**
- 🔁 **إكمال تلقائي** — لو الرد طويل يكمل من نفسه حتى 4 مرات
- 📎 **إرفاق ملفات كود** لإصلاحها أو تطويرها
- 🧠 **ذاكرة طويلة المدى** — يتذكر نظامك ومستواك ومشاريعك
- 🔑 **أي مزود** — Gemini (مجاني) / Groq (مجاني) / OpenAI / Claude / DeepSeek / OpenRouter / Ollama محلي — مع جلب **كل النماذج** المتاحة لحسابك لحظياً
- 🌍 عربي/إنجليزي · Hono + Cloudflare D1 على الـ Edge`)
    openModal('⚡ عن NOVA CODE', box)
  }

  Object.assign(N, { input, autoGrow, send, openSettings, loadConversation, newChat, openModal, closeModal, downloadText })

  // ---------- Offline awareness ----------
  const netBadge = $('#net-badge')
  const syncNet = () => { netBadge.classList.toggle('show', !navigator.onLine); autoGrow() }
  addEventListener('online', syncNet); addEventListener('offline', syncNet); syncNet()

  // ---------- Init ----------
  ;(async () => {
    try { state.meta = await api('/api/meta'); localStorage.setItem('nova_meta', JSON.stringify(state.meta)) }
    catch { state.meta = JSON.parse(localStorage.getItem('nova_meta') || 'null'); if (!state.meta) throw new Error('أول تشغيل يحتاج إنترنت مرة واحدة فقط') }
    state.model = usingByok() && settings.model ? settings.model : state.meta.defaults.model
    setModelUI(); renderSuggestions(); updateKeyStatus()
    refreshMemoryCount()
    await refreshConversations()
    const hash = location.hash.slice(1)
    if (hash && state.conversations.some((c) => c.id === hash)) loadConversation(hash)
    if (usingByok()) refreshModels(false).catch(() => {})
    if (!usingByok() && !state.meta.server_key_configured) setTimeout(openSettings, 500)
    input.focus()
  })().catch((e) => toast('خطأ في التحميل: ' + e.message))
})()
