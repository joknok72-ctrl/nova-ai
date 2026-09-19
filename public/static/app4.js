/* NOVA CODE v6 — part 4: deep mode, provider failover, device preview + console capture, project README export */
;(() => {
  const N = window.N
  const { $, el, esc, state, settings, saveSettings, connected, toast } = N

  // ================= Deep mode toggle =================
  const deepBtn = $('#btn-deep')
  const syncDeep = () => { deepBtn.classList.toggle('on', !!settings.deep); deepBtn.title = settings.deep ? 'الوضع العميق مفعّل: يخطّط → يبني → يراجع نفسه (أدق، أبطأ، يستهلك أكثر)' : 'الوضع العميق متوقف (رد مباشر)' }
  deepBtn.onclick = () => { settings.deep = !settings.deep; saveSettings(); syncDeep(); toast(settings.deep ? '🧠 الوضع العميق: يخطّط ثم يبني ثم يراجع كوده بنفسه' : 'الوضع العادي: رد مباشر', 3000) }
  syncDeep()

  // ================= Failover chain (other connected providers) =================
  N.fallbacks = () => connected()
    .filter(([id]) => id !== state.providerId)
    .map(([id, p]) => { const best = p.models?.find((m) => m.recommended) || p.models?.[0]; return best ? { apiKey: p.apiKey, baseUrl: p.baseUrl, model: best.id, cheap: p.cheap || best.id, label: id } : null })
    .filter(Boolean)

  // ================= Device-size preview + console capture =================
  const frame = $('#preview-frame')
  const bar = $('#tab-preview').querySelector('.flex')
  const sizes = [['📱', 'موبايل', 390, 844], ['📱', 'تابلت', 820, 1180], ['🖥️', 'كامل', 0, 0]]
  const sizeSel = el('select', 'bg-white/5 rounded px-2 py-1 text-xs'); sizes.forEach(([i, n, w], k) => { const o = el('option'); o.value = k; o.textContent = `${i} ${n}`; sizeSel.appendChild(o) }); sizeSel.value = '2'
  const consoleBtn = el('button', 'icon-btn !w-7 !h-7 relative', '<i class="fas fa-terminal"></i><span class="console-badge hidden">0</span>'); consoleBtn.title = 'Console'
  bar.append(sizeSel, consoleBtn)
  const wrap = frame.parentElement
  const stage = el('div', 'preview-stage'); frame.replaceWith(stage); stage.appendChild(frame)
  const consolePane = el('div', 'console-pane hidden'); wrap.appendChild(consolePane)
  let logs = []
  const applySize = () => { const [, , w, h] = sizes[+sizeSel.value]; stage.classList.toggle('device', !!w); frame.style.width = w ? w + 'px' : '100%'; frame.style.height = w ? h + 'px' : '100%'; frame.style.maxHeight = w ? '100%' : '' }
  sizeSel.onchange = applySize; applySize()
  const renderConsole = () => {
    const b = consoleBtn.querySelector('.console-badge'); const errs = logs.filter((l) => l.level === 'error').length
    b.textContent = errs; b.classList.toggle('hidden', !errs)
    consolePane.innerHTML = logs.length ? '' : '<div class="text-slate-500 p-2 text-xs">لا توجد رسائل — افتح المعاينة وتفاعل معها</div>'
    for (const l of logs.slice(-200)) { const d = el('div', `cl cl-${l.level}`); d.textContent = l.text; consolePane.appendChild(d) }
    if (logs.some((l) => l.level === 'error')) { const fix = el('button', 'btn-primary !py-1.5 !px-3 text-xs m-2', '<i class="fas fa-wand-magic-sparkles"></i> أصلح هذه الأخطاء تلقائياً'); fix.onclick = () => { const errs = logs.filter((l) => l.level === 'error').map((l) => l.text).slice(0, 8).join('\n'); N.input.value = `الموقع بيطلع الأخطاء دي في الـ console عند التشغيل:\n\`\`\`\n${errs}\n\`\`\`\nصلّحها وأعطني الملفات المعدلة كاملة.`; N.autoGrow(); N.closeFiles?.(); N.input.focus(); toast('اضغط إرسال لإصلاح الأخطاء') }; consolePane.prepend(fix) }
    consolePane.scrollTop = consolePane.scrollHeight
  }
  consoleBtn.onclick = () => { consolePane.classList.toggle('hidden'); renderConsole() }
  window.addEventListener('message', (e) => { if (e.source !== frame.contentWindow || !e.data || e.data.__novaConsole !== true) return; logs.push({ level: e.data.level, text: e.data.text }); renderConsole() })
  // inject console bridge into preview html
  const BRIDGE = `<script>(function(){var s=function(l,a){try{parent.postMessage({__novaConsole:true,level:l,text:Array.prototype.map.call(a,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){s(k==='warn'?'warn':k==='error'?'error':'log',arguments);o&&o.apply(console,arguments)}});window.addEventListener('error',function(e){s('error',[(e.message||'')+' @ line '+(e.lineno||'?')])});window.addEventListener('unhandledrejection',function(e){s('error',['Unhandled promise: '+(e.reason&&e.reason.message||e.reason)])})})()<\/script>`
  const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')
  Object.defineProperty(frame, 'srcdoc', { set(v) { logs = []; renderConsole(); const html = String(v || ''); desc.set.call(this, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BRIDGE) : BRIDGE + html) }, get() { return desc.get.call(this) } })
  N.closeFiles = N.closeFiles || (() => $('#files-panel').classList.add('hidden'))

  // ================= Project README export (adds to ZIP) =================
  const zipBtn = $('#btn-zip')
  const origZip = zipBtn.onclick
  zipBtn.onclick = async () => {
    const paths = Object.keys(state.files)
    if (paths.length && !state.files['README.md'] && !state.files['readme.md']) {
      const lastA = [...document.querySelectorAll('#message-list .msg.assistant')].pop()?.dataset.raw || ''
      const steps = (lastA.match(/(?:▶️|##+\s*(?:Run|تشغيل|▶️)[^\n]*)\n[\s\S]{0,1500}?(?=\n##|\n---|$)/) || [''])[0]
      state.files['README.md'] = `# ${state.current?.title || 'Project'}\n\nGenerated with NOVA CODE.\n\n## Files\n${paths.map((p) => '- `' + p + '`').join('\n')}\n\n## Run\n${steps.trim() || 'See the conversation for run steps.'}\n`
    }
    return origZip?.()
  }
})()
