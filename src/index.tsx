// NOVA CODE — stateless edge relay.
// The server stores NOTHING. All conversations/memory live in the user's browser (IndexedDB).
// The only network traffic is the model call itself (a few KB per message).
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { chatStream, chatOnce, consumeSSE, estimateTokens, looksLikeProviderError, type ChatMessage, type LLMEnv } from './llm'
import { MODELS, DEFAULT_MODEL, ALLOWED_MODELS, SYSTEM_PROMPT } from './personas'
import { PROVIDERS, discoverModels, detectProvider, pickCheapModel } from './providers'
import { page } from './page'
import { webSearch, fetchPage, TOOLS_PROMPT, parseToolCall } from './search'

type Bindings = { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ---------- UI ----------
app.get('/', (c) => c.html(page(), 200, { 'Cache-Control': 'public, max-age=300' }))

// Service worker must live at the root scope; proxy it from the static asset with the right headers.
app.get('/sw.js', async (c) => {
  const url = new URL('/static/sw.js', c.req.url)
  const res = await fetch(url.toString(), { headers: { 'x-nova-internal': '1' } })
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } })
})

// ---------- Meta ----------
app.get('/api/meta', (c) =>
  c.json({
    server_key_configured: !!c.env.OPENAI_API_KEY,
    models: MODELS,
    providers: PROVIDERS,
    defaults: { model: DEFAULT_MODEL },
    version: 3,
  })
)

// ---------- Live model discovery (BYOK) ----------
app.post('/api/models', async (c) => {
  const { apiKey, baseUrl } = await c.req.json().catch(() => ({}))
  if (!apiKey || typeof apiKey !== 'string') return c.json({ error: 'apiKey required' }, 400)
  const base = (baseUrl || 'https://api.openai.com/v1').toString()
  try {
    const models = await discoverModels(base, apiKey)
    return c.json({ provider: detectProvider(base), models, cheap: pickCheapModel(models, models[0]?.id || '') })
  } catch (e: any) {
    return c.json({ error: e?.message || 'discovery failed' }, 502)
  }
})

// ---------- Web search (used by the model; also exposed for the UI) ----------
app.get('/api/search', async (c) => {
  const q = c.req.query('q') || ''
  try { return c.json({ results: await webSearch(q, 8) }) } catch (e: any) { return c.json({ error: e?.message }, 502) }
})

// ---------- Chat (streaming relay) ----------
const MAX_CONTEXT_TOKENS = 60000
const MAX_AUTO_CONTINUES = 3

type InMsg = { role: 'user' | 'assistant'; content: string; images?: { type: 'image'; dataUrl: string }[] }

function buildContext(instructions: string, history: InMsg[], os?: string, webEnabled = true): ChatMessage[] {
  let sys = SYSTEM_PROMPT
  if (webEnabled) sys += `\n${TOOLS_PROMPT}`
  sys += `\n\n# Images\nThe user may attach screenshots/photos (UI designs, error screens, whiteboard sketches, existing apps). Read them carefully: reproduce designs as pixel-faithful code, diagnose errors from screenshots, extract text/tables. If you cannot see images, say so plainly.`
  if (instructions.trim()) sys += `\n\n# User's standing instructions\n${instructions.trim().slice(0, 8000)}`
  if (os) sys += `\n\nUser's device/OS (from browser): ${os}. Give commands for this OS unless the user says otherwise.`
  sys += `\n\nCurrent date: ${new Date().toISOString().slice(0, 10)}`
  const out: ChatMessage[] = []
  let budget = MAX_CONTEXT_TOKENS - estimateTokens(sys)
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    const t = estimateTokens(m.content)
    if (budget - t < 0 && out.length > 0) break
    budget -= t
    out.unshift({ role: m.role, content: m.content, images: m.images?.length ? m.images : undefined })
  }
  return [{ role: 'system', content: sys }, ...out]
}

function resolveLLM(c: any): { env: LLMEnv; byok: boolean; cheapModel: string } {
  const key = c.req.header('x-nova-key')
  const base = c.req.header('x-nova-base-url')
  if (key && key.length > 10) {
    return { env: { OPENAI_API_KEY: key, OPENAI_BASE_URL: base || 'https://api.openai.com/v1' }, byok: true, cheapModel: c.req.header('x-nova-cheap-model') || '' }
  }
  return { env: { OPENAI_API_KEY: c.env.OPENAI_API_KEY || '', OPENAI_BASE_URL: c.env.OPENAI_BASE_URL }, byok: false, cheapModel: 'gpt-5-mini' }
}

app.post('/api/chat', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  // history: full conversation from the browser (already includes the new user message)
  const history: InMsg[] = Array.isArray(body.messages)
    ? body.messages.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-200).map((m: any, i: number, arr: any[]) => ({
        role: m.role, content: m.content,
        // keep images only on the last 2 user turns (token/bandwidth budget)
        images: Array.isArray(m.images) && i >= arr.length - 4 ? m.images.filter((x: any) => x && typeof x.dataUrl === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(x.dataUrl) && x.dataUrl.length < 6_000_000).slice(0, 4) : undefined,
      }))
    : []
  const instructions: string = typeof body.instructions === 'string' ? body.instructions : ''
  const webEnabled: boolean = body.web !== false
  const os: string | undefined = typeof body.os === 'string' ? body.os.slice(0, 40) : undefined
  const wantTitle = !!body.want_title
  if (!history.length || history[history.length - 1].role !== 'user') return c.json({ error: 'messages must end with a user message' }, 400)
  const total = history.reduce((n, m) => n + m.content.length, 0)
  if (total > 1_200_000) return c.json({ error: 'conversation too long' }, 400)

  const llm = resolveLLM(c)
  if (!llm.env.OPENAI_API_KEY) return c.json({ error: 'no_api_key', message: 'لا يوجد مفتاح API. أضف مفتاحك من الإعدادات.' }, 400)
  const modelOk = (m: unknown) => typeof m === 'string' && m.length > 0 && m.length < 80 && (llm.byok || ALLOWED_MODELS.has(m))
  const model: string = modelOk(body.model) ? body.model : DEFAULT_MODEL
  const cheapModel = llm.cheapModel || model
  const userText = history[history.length - 1].content

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'meta', data: JSON.stringify({ model }) })
    let full = ''
    try {
      const base = buildContext(instructions, history, os, webEnabled)
      let messages: ChatMessage[] = [...base]
      const toolLog: string[] = []
      let toolCalls = 0
      // Outer loop: tool calls (search/fetch). Inner: auto-continue on output-limit cutoff.
      outer: while (true) {
        let text = ''
        let finish = ''
        let buffered = '' // hold back the very start of a reply so a tool call never leaks to the UI
        let decided = false
        for (let pass = 0; pass <= MAX_AUTO_CONTINUES; pass++) {
          const res = await chatStream(llm.env, model, pass === 0 ? messages : [...messages, { role: 'assistant', content: text }, { role: 'user', content: 'Your previous message was cut off by the output limit. Continue EXACTLY from where you stopped — do not repeat anything, do not add an intro. If you were inside a code block, continue the code directly (the block is still open).' }])
          const r = await consumeSSE(res.body!, async (delta) => {
            if (!decided) {
              buffered += delta
              if (buffered.trimStart().startsWith('<<TOOL>>') || (buffered.trim().length < 8 && '<<TOOL>>'.startsWith(buffered.trim()))) return // possible tool call: keep buffering
              decided = true
              await stream.writeSSE({ event: 'delta', data: JSON.stringify({ t: buffered }) })
              buffered = ''
              return
            }
            await stream.writeSSE({ event: 'delta', data: JSON.stringify({ t: delta }) })
          })
          text += r.text
          finish = r.finish
          if (finish !== 'length' || !r.text) break
          if (decided) await stream.writeSSE({ event: 'status', data: JSON.stringify({ s: 'continuing', pass: pass + 1 }) })
        }
        const call = webEnabled && toolCalls < 4 ? parseToolCall(text) : null
        if (call) {
          toolCalls++
          let result = ''
          try {
            if (call.tool === 'search') {
              await stream.writeSSE({ event: 'status', data: JSON.stringify({ s: 'search', q: call.query }) })
              const rs = await webSearch(call.query, 6)
              result = rs.length ? rs.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join('\n') : 'No results.'
              toolLog.push(`🔍 ${call.query}`)
            } else {
              await stream.writeSSE({ event: 'status', data: JSON.stringify({ s: 'fetch', url: call.url }) })
              result = await fetchPage(call.url)
              toolLog.push(`📄 ${call.url}`)
            }
          } catch (e: any) { result = `Tool error: ${e?.message || e}` }
          messages = [...messages, { role: 'assistant', content: text }, { role: 'user', content: `TOOL RESULT for ${call.tool}:\n${result}\n\nNow continue answering the user's request. Call another tool only if still necessary.` }]
          continue outer
        }
        // not a tool call: flush anything still buffered
        if (!decided && buffered) await stream.writeSSE({ event: 'delta', data: JSON.stringify({ t: buffered }) })
        full = text
        if (toolLog.length) await stream.writeSSE({ event: 'tools', data: JSON.stringify({ log: toolLog }) })
        break
      }
    } catch (err: any) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: err?.code ?? 'upstream', message: err?.message ?? 'LLM failed', partial: !!full }) })
      return
    }
    if (!full.trim()) return stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'empty', message: 'لم يصل رد من النموذج. حاول مرة أخرى أو بدّل النموذج.' }) })
    if (looksLikeProviderError(full)) return stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'provider', message: full.trim() }) })

    // Optional extras (cheap model). Failures are ignored — the answer is already delivered.
    let title: string | undefined
    if (wantTitle) {
      try {
        const t = await chatOnce(llm.env, cheapModel, [
          { role: 'system', content: 'Generate a very short project/conversation title (max 6 words) in the same language as the user message. Reply with the title only — no quotes, no trailing punctuation.' },
          { role: 'user', content: `User: ${userText.slice(0, 600)}\nAssistant: ${full.slice(0, 400)}` },
        ])
        title = t.trim().split('\n')[0].replace(/^["'«»#*\s]+|["'«»*\s]+$/g, '').slice(0, 80) || undefined
      } catch {}
    }
    await stream.writeSSE({ event: 'done', data: JSON.stringify({ title, tokens: estimateTokens(full) }) })
  })
})

app.notFound((c) => c.json({ error: 'not found' }, 404))
export default app
