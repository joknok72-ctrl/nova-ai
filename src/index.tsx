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

type Bindings = { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ---------- UI ----------
app.get('/', (c) => c.html(page(), 200, { 'Cache-Control': 'public, max-age=300' }))

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

// ---------- Chat (streaming relay) ----------
const MAX_CONTEXT_TOKENS = 60000
const MAX_AUTO_CONTINUES = 3

type InMsg = { role: 'user' | 'assistant'; content: string }

function buildContext(memories: string[], history: InMsg[], os?: string): ChatMessage[] {
  let sys = SYSTEM_PROMPT
  if (memories.length) sys += `\n\n# Known facts about the user\n` + memories.map((m) => `- ${m}`).join('\n')
  if (os) sys += `\n\nUser's device/OS (from browser): ${os}. Give commands for this OS unless the user says otherwise.`
  sys += `\n\nCurrent date: ${new Date().toISOString().slice(0, 10)}`
  const out: ChatMessage[] = []
  let budget = MAX_CONTEXT_TOKENS - estimateTokens(sys)
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    const t = estimateTokens(m.content)
    if (budget - t < 0 && out.length > 0) break
    budget -= t
    out.unshift({ role: m.role, content: m.content })
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
    ? body.messages.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-200)
    : []
  const memories: string[] = Array.isArray(body.memories) ? body.memories.filter((m: any) => typeof m === 'string').slice(0, 60) : []
  const os: string | undefined = typeof body.os === 'string' ? body.os.slice(0, 40) : undefined
  const wantTitle = !!body.want_title
  const wantFacts = !!body.want_facts
  if (!history.length || history[history.length - 1].role !== 'user') return c.json({ error: 'messages must end with a user message' }, 400)
  const total = history.reduce((n, m) => n + m.content.length, 0)
  if (total > 800000) return c.json({ error: 'conversation too long' }, 400)

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
      let messages = buildContext(memories, history, os)
      for (let pass = 0; pass <= MAX_AUTO_CONTINUES; pass++) {
        const res = await chatStream(llm.env, model, messages)
        const { text, finish } = await consumeSSE(res.body!, async (delta) => {
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ t: delta }) })
        })
        full += text
        if (finish !== 'length' || !text) break
        await stream.writeSSE({ event: 'status', data: JSON.stringify({ s: 'continuing', pass: pass + 1 }) })
        messages = [
          ...buildContext(memories, history, os),
          { role: 'assistant', content: full },
          { role: 'user', content: 'Your previous message was cut off by the output limit. Continue EXACTLY from where you stopped — do not repeat anything, do not add an intro. If you were inside a code block, continue the code directly (the block is still open).' },
        ]
      }
    } catch (err: any) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: err?.code ?? 'upstream', message: err?.message ?? 'LLM failed', partial: !!full }) })
      return
    }
    if (!full.trim()) return stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'empty', message: 'لم يصل رد من النموذج. حاول مرة أخرى أو بدّل النموذج.' }) })
    if (looksLikeProviderError(full)) return stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'provider', message: full.trim() }) })

    // Optional extras (cheap model). Failures are ignored — the answer is already delivered.
    let title: string | undefined
    let facts: string[] = []
    if (wantTitle) {
      try {
        const t = await chatOnce(llm.env, cheapModel, [
          { role: 'system', content: 'Generate a very short project/conversation title (max 6 words) in the same language as the user message. Reply with the title only — no quotes, no trailing punctuation.' },
          { role: 'user', content: `User: ${userText.slice(0, 600)}\nAssistant: ${full.slice(0, 400)}` },
        ])
        title = t.trim().split('\n')[0].replace(/^["'«»#*\s]+|["'«»*\s]+$/g, '').slice(0, 80) || undefined
      } catch {}
    }
    if (wantFacts && userText.length > 15) {
      try {
        const raw = await chatOnce(llm.env, cheapModel, [
          { role: 'system', content: `Extract durable facts about the USER that would help in future coding sessions: name, OS, skill level, preferred stack/languages, project names & what they're building, tools/hosting/DB they use, accounts they own (never secrets), language preference. Ignore one-off questions and code content. Return ONLY a JSON array of short strings in the user's language, max 3 items. If nothing durable, return [].` },
          { role: 'user', content: userText.slice(0, 4000) },
        ])
        const match = raw.match(/\[[\s\S]*\]/)
        if (match) { const arr = JSON.parse(match[0]); if (Array.isArray(arr)) facts = arr.filter((f) => typeof f === 'string' && f.trim().length > 3).slice(0, 3).map((f) => f.trim().slice(0, 300)) }
      } catch {}
    }
    await stream.writeSSE({ event: 'done', data: JSON.stringify({ title, facts, tokens: estimateTokens(full) }) })
  })
})

app.notFound((c) => c.json({ error: 'not found' }, 404))
export default app
