/* NOVA CODE v5 — part 3: images (vision), in-browser code runner, file editing, voice input, share */
;(() => {
  const N = window.N
  const { $, el, esc, state, settings, saveSettings, toast, isMobile } = N

  // ================= Images (vision) =================
  state.images = [] // pending: [{ dataUrl, name }]
  const MAX_IMG_PX = 1600
  async function compressImage(file) {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
      const scale = Math.min(1, MAX_IMG_PX / Math.max(img.width, img.height))
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL(file.type === 'image/png' && file.size < 900000 ? 'image/png' : 'image/jpeg', 0.86)
    } finally { URL.revokeObjectURL(url) }
  }
  async function addImageFiles(files) {
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue
      if (state.images.length >= 4) { toast('الحد 4 صور لكل رسالة'); break }
      try { state.images.push({ dataUrl: await compressImage(f), name: f.name || 'image' }) } catch { toast('تعذر قراءة الصورة') }
    }
    renderImages(); N.autoGrow()
  }
  function renderImages() {
    const box = $('#attachments')
    box.querySelectorAll('.img-chip').forEach((x) => x.remove())
    state.images.forEach((im, i) => {
      const c = el('span', 'img-chip')
      c.innerHTML = `<img src="${im.dataUrl}" alt=""><button title="إزالة"><i class="fas fa-times"></i></button>`
      c.querySelector('button').onclick = () => { state.images.splice(i, 1); renderImages(); N.autoGrow() }
      box.appendChild(c)
    })
  }
  $('#btn-image').onclick = () => $('#image-input').click()
  $('#image-input').onchange = (e) => { addImageFiles([...e.target.files]); e.target.value = '' }
  // paste / drop images
  document.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); addImageFiles(files) } })
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => { e.preventDefault(); const fs = [...(e.dataTransfer?.files || [])]; addImageFiles(fs.filter((f) => /^image\//.test(f.type))); const code = fs.filter((f) => !/^image\//.test(f.type)); if (code.length) { const inp = $('#file-input'); const dt = new DataTransfer(); code.forEach((f) => dt.items.add(f)); inp.files = dt.files; inp.dispatchEvent(new Event('change')) } })

  N.renderImages = renderImages
  // store.addMessage wrapper: attach pendingImages to the next user message
  const origAdd = N.store.addMessage.bind(N.store)
  N.store.addMessage = async (convId, role, content, tokens) => {
    if (role === 'user' && N.pendingImages?.length) {
      const images = N.pendingImages.map((im) => ({ type: 'image', dataUrl: im.dataUrl })); N.pendingImages = []
      return N.store._addMessageWithImages(convId, role, content, tokens, images)
    }
    return origAdd(convId, role, content, tokens)
  }
  // render images inside user bubbles
  const origAddMessage = N.addMessage
  if (origAddMessage) N.addMessage = (role, content, opts = {}) => { const w = origAddMessage(role, content, opts); if (role === 'user' && opts.images?.length) { const g = el('div', 'msg-imgs'); for (const im of opts.images) { const i = el('img'); i.src = im.dataUrl; i.onclick = () => window.open(im.dataUrl, '_blank'); g.appendChild(i) } w.querySelector('.bubble .content').after(g) } return w }

  // ================= In-browser code runner =================
  let pyodide = null, pyLoading = null
  async function getPyodide(onStatus) {
    if (pyodide) return pyodide
    if (!pyLoading) pyLoading = (async () => {
      onStatus?.('تحميل Python (مرة واحدة ~10MB)…')
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js'; s.onload = res; s.onerror = () => rej(new Error('تعذر تحميل Python — يحتاج إنترنت أول مرة')); document.head.appendChild(s) })
      pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' })
      return pyodide
    })()
    return pyLoading
  }
  async function runPython(code, onOut) {
    const py = await getPyodide(onOut)
    py.setStdout({ batched: (t) => onOut(t + '\n') }); py.setStderr({ batched: (t) => onOut(t + '\n', true) })
    // auto-install pure-python packages mentioned in imports
    const imports = [...code.matchAll(/^\s*(?:from|import)\s+([a-zA-Z_][\w]*)/gm)].map((m) => m[1])
    const known = { requests: 'requests', numpy: 'numpy', pandas: 'pandas', matplotlib: 'matplotlib', bs4: 'beautifulsoup4', sympy: 'sympy', PIL: 'pillow', yaml: 'pyyaml' }
    const need = [...new Set(imports.filter((i) => known[i]))]
    if (need.length) { onOut(`📦 تحميل: ${need.join(', ')}…\n`); try { await py.loadPackage(need.map((i) => known[i])) } catch (e) { onOut(`⚠️ ${e.message}\n`, true) } }
    try { const r = await py.runPythonAsync(code); if (r !== undefined && r !== null) onOut(String(r) + '\n') } catch (e) { onOut(String(e.message || e) + '\n', true) }
  }
  function runJS(code, onOut) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe'); f.sandbox = 'allow-scripts'; f.style.display = 'none'; document.body.appendChild(f)
      const id = Math.random().toString(36).slice(2)
      const handler = (e) => { if (e.data?.__nova !== id) return; if (e.data.done) { window.removeEventListener('message', handler); f.remove(); resolve() } else onOut(e.data.text + '\n', e.data.err) }
      window.addEventListener('message', handler)
      const src = `<script>const ID=${JSON.stringify(id)};const send=(text,err)=>parent.postMessage({__nova:ID,text,err},'*');['log','info','warn','error'].forEach(k=>{console[k]=(...a)=>send(a.map(x=>{try{return typeof x==='object'?JSON.stringify(x,null,1):String(x)}catch{return String(x)}}).join(' '),k==='error'||k==='warn')});window.onerror=(m,s,l,c,e)=>send((e&&e.stack)||m,true);(async()=>{try{await (async()=>{${code.replace(/<\/script>/gi, '<\\/script>')}\n})()}catch(e){send(String(e&&e.stack||e),true)}finally{parent.postMessage({__nova:ID,done:true},'*')}})()<\/script>`
      f.srcdoc = src
      setTimeout(() => { window.removeEventListener('message', handler); f.remove(); resolve() }, 15000)
    })
  }
  const RUNNABLE = { python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'js', ts: 'js' }
  async function runCode(lang, code, outEl) {
    outEl.classList.remove('hidden'); outEl.innerHTML = ''
    const write = (t, err) => { const s = el('span', err ? 'text-red-300' : ''); s.textContent = t; outEl.appendChild(s); outEl.scrollTop = outEl.scrollHeight }
    const kind = RUNNABLE[lang]
    try {
      if (kind === 'py') await runPython(code, write)
      else if (kind === 'js') { if (/^ts|typescript/.test(lang)) code = code.replace(/:\s*[A-Za-z<>\[\]|&,\s]+(?=[=;,)])/g, '').replace(/^\s*(import|export)\s.*$/gm, '') ; await runJS(code, write) }
      if (!outEl.textContent.trim()) write('✓ تم التنفيذ بدون مخرجات\n')
    } catch (e) { write(String(e.message || e) + '\n', true) }
  }
  // add "Run" buttons to code blocks via delegation (blocks are re-rendered on stream)
  const enhanceBlocks = (root) => {
    root.querySelectorAll('.code-block:not([data-run])').forEach((cb) => {
      cb.dataset.run = '1'
      const code = cb.querySelector('code'); const lang = (code?.dataset.lang || '').toLowerCase()
      if (!RUNNABLE[lang]) return
      const btn = el('button', 'cb-run', `<i class="fas fa-play"></i> Run`)
      const out = el('pre', 'run-out hidden', '')
      btn.onclick = (e) => { e.stopPropagation(); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; runCode(lang, code.innerText, out).finally(() => (btn.innerHTML = '<i class="fas fa-play"></i> Run')) }
      cb.querySelector('.cb-actions').prepend(btn); cb.appendChild(out)
    })
  }
  new MutationObserver(() => enhanceBlocks(document)).observe($('#message-list'), { childList: true, subtree: true })

  // ================= File editing in the files panel =================
  const fileView = $('#file-view')
  const editBtn = el('button', 'icon-btn !w-7 !h-7', '<i class="fas fa-pen"></i>'); editBtn.title = 'تعديل'
  const runFileBtn = el('button', 'icon-btn !w-7 !h-7', '<i class="fas fa-play"></i>'); runFileBtn.title = 'تشغيل'
  const fileRunOut = el('pre', 'run-out hidden'); $('#tab-files').querySelector('.flex-1.flex-col').appendChild(fileRunOut)
  new MutationObserver(() => { const head = $('#file-head'); if (head.children.length && !head.contains(editBtn)) { head.append(editBtn, runFileBtn); const lang = (state.activeFile || '').split('.').pop(); runFileBtn.classList.toggle('hidden', !RUNNABLE[lang]) } }).observe($('#file-head'), { childList: true })
  editBtn.onclick = () => {
    const p = state.activeFile; if (!p) return
    const ta = el('textarea', 'file-editor'); ta.value = state.files[p]; ta.spellcheck = false
    const bar = el('div', 'flex gap-2 p-2 border-t border-white/5 justify-end', `<button class="chip fe-cancel">إلغاء</button><button class="btn-primary !py-1.5 !px-4 fe-save"><i class="fas fa-check"></i> حفظ</button>`)
    fileView.classList.add('hidden'); fileView.after(ta); ta.after(bar); ta.focus()
    const done = () => { ta.remove(); bar.remove(); fileView.classList.remove('hidden') }
    bar.querySelector('.fe-cancel').onclick = done
    bar.querySelector('.fe-save').onclick = () => { state.files[p] = ta.value; done(); N.renderFileTree?.(); toast('تم حفظ التعديل (محلياً)') }
  }
  runFileBtn.onclick = () => { const p = state.activeFile; runCode(p.split('.').pop(), state.files[p], fileRunOut) }

  // ================= Voice input (Web Speech API) =================
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const micBtn = $('#btn-mic')
  if (!SR) micBtn.classList.add('hidden')
  else {
    let rec = null, listening = false
    micBtn.onclick = () => {
      if (listening) { rec.stop(); return }
      rec = new SR(); rec.lang = /[\u0600-\u06FF]/.test(N.input.value) || navigator.language.startsWith('ar') ? 'ar-EG' : navigator.language; rec.interimResults = true; rec.continuous = false
      const base = N.input.value ? N.input.value + ' ' : ''
      rec.onresult = (e) => { let t = ''; for (const r of e.results) t += r[0].transcript; N.input.value = base + t; N.autoGrow() }
      rec.onstart = () => { listening = true; micBtn.classList.add('listening') }
      rec.onend = () => { listening = false; micBtn.classList.remove('listening'); N.input.focus() }
      rec.onerror = (e) => { toast(e.error === 'not-allowed' ? 'اسمح بالوصول للميكروفون' : 'خطأ في التعرف على الصوت'); listening = false; micBtn.classList.remove('listening') }
      rec.start()
    }
  }

  // ================= Share project (offline-safe: data in URL hash) =================
  $('#btn-share').onclick = async () => {
    if (!state.current) return
    const msgs = await N.store.listMessages(state.current.id)
    const payload = { v: 1, title: state.current.title, messages: msgs.map((m) => ({ role: m.role, content: m.content })) }
    const json = JSON.stringify(payload)
    // compress with CompressionStream when available
    let b64
    if ('CompressionStream' in window) { const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')); const buf = await new Response(cs).arrayBuffer(); b64 = 'gz.' + btoa(String.fromCharCode(...new Uint8Array(buf))) }
    else b64 = 'raw.' + btoa(unescape(encodeURIComponent(json)))
    const url = `${location.origin}/#share=${b64}`
    if (url.length > 60000) return toast('المحادثة كبيرة جداً للمشاركة برابط — استخدم تصدير Markdown', 3500)
    if (navigator.share && isMobile()) { try { await navigator.share({ title: state.current.title, url }); return } catch {} }
    try { await navigator.clipboard.writeText(url); toast('تم نسخ رابط المشاركة') }
    catch { const box = el('div', 'space-y-2 text-sm'); box.innerHTML = `<p class="text-slate-400 text-xs">انسخ الرابط:</p><textarea class="input-dark w-full mono text-xs" dir="ltr" rows="4" readonly>${esc(url)}</textarea>`; N.openModal('🔗 رابط المشاركة', box); box.querySelector('textarea').select() }
  }
  ;(async () => {
    const m = location.hash.match(/^#share=(gz|raw)\.(.+)$/)
    if (!m) return
    try {
      let json
      if (m[1] === 'gz') { const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text() }
      else json = decodeURIComponent(escape(atob(m[2])))
      const data = JSON.parse(json)
      const conv = await N.store.createConversation(state.model, state.providerId)
      await N.store.updateConversation(conv.id, { title: (data.title || 'مشروع مشترك') + ' (مشترك)' })
      for (const msg of data.messages) await N.store._addMessageWithImages(conv.id, msg.role, msg.content, 0, undefined, true)
      history.replaceState(null, '', `#${conv.id}`); await N.refreshConversations(); N.loadConversation(conv.id); toast('تم استيراد المشروع المشترك')
    } catch (e) { toast('رابط مشاركة غير صالح') }
  })()
})()
