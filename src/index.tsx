import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import { db, uid } from './db'
import { chatStream, chatOnce, consumeSSE, estimateTokens, looksLikeProviderError, type ChatMessage, type LLMEnv } from './llm'
import { PERSONAS, DEFAULT_PERSONA, MODELS, DEFAULT_MODEL, ALLOWED_MODELS, SYSTEM_PROMPT } from './personas'
import { PROVIDERS, discoverModels, detectProvider, pickCheapModel } from './providers'
import { page } from './page'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL?: string }
type Variables = { userId: string }

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors())

// ---------- Identity: anonymous, cookie-based ----------
app.use('*', async (c, next) => {
  let userId = getCookie(c, 'nova_uid')
  if (!userId || !/^[a-f0-9]{32}$/.test(userId)) {
    userId = uid(16)
    setCookie(c, 'nova_uid', userId, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 365 })
  }
  c.set('userId', userId)
  await next()
})

// ---------- UI ----------
app.get('/', (c) => c.html(page()))

// ---------- Meta ----------
app.get('/api/meta', async (c) => {
  const stats = await db.getStats(c.env.DB, c.get('userId'))
  return c.json({
    server_key_configured: !!c.env.OPENAI_API_KEY,
    personas: Object.values(PERSONAS).map(({ systemPrompt, ...p }) => p),
    models: MODELS,
    providers: PROVIDERS,
    defaults: { persona: DEFAULT_PERSONA, model: DEFAULT_MODEL },
    stats,
  })
})

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

// ---------- Conversations ----------
app.get('/api/conversations', async (c) => c.json(await db.listConversations(c.env.DB, c.get('userId'))))

app.post('/api/conversations', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const model = typeof body.model === 'string' && body.model ? body.model.slice(0, 80) : DEFAULT_MODEL
  return c.json(await db.createConversation(c.env.DB, c.get('userId'), DEFAULT_PERSONA, model), 201)
})

app.get('/api/conversations/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'), c.get('userId'))
  if (!conv) return c.json({ error: 'not found' }, 404)
  return c.json({ ...conv, messages: await db.listMessages(c.env.DB, conv.id) })
})

app.patch('/api/conversations/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'), c.get('userId'))
  if (!conv) return c.json({ error: 'not found' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const patch: any = {}
  if (typeof body.title === 'string') patch.title = body.title.slice(0, 120)
  if (typeof body.model === 'string' && body.model) patch.model = body.model.slice(0, 80)
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned ? 1 : 0
  await db.updateConversation(c.env.DB, conv.id, c.get('userId'), patch)
  return c.json(await db.getConversation(c.env.DB, conv.id, c.get('userId')))
})

app.delete('/api/conversations/:id', async (c) => {
  await db.deleteConversation(c.env.DB, c.req.param('id'), c.get('userId'))
  return c.json({ ok: true })
})

// ---------- Memory ----------
app.get('/api/memories', async (c) => c.json(await db.listMemories(c.env.DB, c.get('userId'))))
app.post('/api/memories', async (c) => {
  const { fact } = await c.req.json().catch(() => ({}))
  if (!fact || typeof fact !== 'string') return c.json({ error: 'fact required' }, 400)
  await db.addMemory(c.env.DB, c.get('userId'), fact.slice(0, 300))
  return c.json({ ok: true }, 201)
})
app.delete('/api/memories/:id', async (c) => {
  await db.deleteMemory(c.env.DB, Number(c.req.param('id')), c.get('userId'))
  return c.json({ ok: true })
})
app.delete('/api/memories', async (c) => {
  await db.clearMemories(c.env.DB, c.get('userId'))
  return c.json({ ok: true })
})

// ---------- Chat (streaming) ----------
const MAX_CONTEXT_TOKENS = 60000
const MAX_AUTO_CONTINUES = 3

function buildContext(memories: string[], history: { role: string; content: string }[], os?: string): ChatMessage[] {
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
    out.unshift({ role: m.role as ChatMessage['role'], content: m.content })
  }
  return [{ role: 'system', content: sys }, ...out]
}

/** Resolve LLM credentials: BYOK headers (browser-stored key) or the server's key. */
function resolveLLM(c: any): { env: LLMEnv; byok: boolean; cheapModel: string } {
  const key = c.req.header('x-nova-key')
  const base = c.req.header('x-nova-base-url')
  if (key && key.length > 10) {
    return { env: { OPENAI_API_KEY: key, OPENAI_BASE_URL: base || 'https://api.openai.com/v1' }, byok: true, cheapModel: c.req.header('x-nova-cheap-model') || '' }
  }
  return { env: { OPENAI_API_KEY: c.env.OPENAI_API_KEY, OPENAI_BASE_URL: c.env.OPENAI_BASE_URL }, byok: false, cheapModel: 'gpt-5-mini' }
}

app.post('/api/chat', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({}))
  let content: string = (body.content ?? '').toString().trim()
  const regenerate: boolean = !!body.regenerate
  const attachments: { name: string; content: string }[] = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : []
  const os: string | undefined = typeof body.os === 'string' ? body.os.slice(0, 40) : undefined

  // Inline text attachments (code files the user uploaded)
  if (attachments.length) {
    const blocks = attachments
      .filter((a) => a && typeof a.name === 'string' && typeof a.content === 'string')
      .map((a) => `\n\n### 📎 ${a.name.slice(0, 120)}\n\`\`\`${(a.name.split('.').pop() || '').slice(0, 12)}\n${a.content.slice(0, 120000)}\n\`\`\``)
      .join('')
    content = (content || 'Here are my files:') + blocks
  }
  if (!content && !regenerate) return c.json({ error: 'content required' }, 400)
  if (content.length > 400000) return c.json({ error: 'message too long' }, 400)

  const llm = resolveLLM(c)
  if (!llm.env.OPENAI_API_KEY) return c.json({ error: 'no_api_key', message: 'لا يوجد مفتاح API. أضف مفتاحك من الإعدادات.' }, 400)

  const DB = c.env.DB
  const modelOk = (m: unknown) => typeof m === 'string' && m.length > 0 && m.length < 80 && (llm.byok || ALLOWED_MODELS.has(m))
  let conv = body.conversation_id ? await db.getConversation(DB, body.conversation_id, userId) : null
  if (!conv) conv = await db.createConversation(DB, userId, DEFAULT_PERSONA, modelOk(body.model) ? body.model : DEFAULT_MODEL)
  const model = modelOk(body.model) ? body.model : conv.model
  const cheapModel = llm.cheapModel || model

  let history = await db.listMessages(DB, conv.id)
  let userMsgId = 0
  if (regenerate) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant) {
      await db.deleteMessagesFrom(DB, conv.id, lastAssistant.id)
      history = history.filter((m) => m.id < lastAssistant.id)
    }
  } else {
    userMsgId = await db.addMessage(DB, conv.id, 'user', content, estimateTokens(content))
    history.push({ id: userMsgId, conversation_id: conv.id, role: 'user', content, tokens: 0, created_at: '' })
  }

  const memories = (await db.listMemories(DB, userId)).map((m) => m.fact)
  const isFirstTurn = history.filter((m) => m.role === 'user').length === 1
  const convId = conv.id
  const userText = content

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'meta', data: JSON.stringify({ conversation_id: convId, model }) })
    let full = ''
    const fail = async (code: string, message: string) => {
      if (!full) {
        if (userMsgId) await db.deleteMessagesFrom(DB, convId, userMsgId).catch(() => {})
        const remaining = await db.listMessages(DB, convId, 1)
        if (!remaining.length) await db.deleteConversation(DB, convId, userId).catch(() => {})
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code, message, conversation_deleted: !remaining.length }) })
      } else {
        // keep partial output
        await db.addMessage(DB, convId, 'assistant', full, estimateTokens(full))
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code, message, partial: true }) })
      }
    }

    try {
      // First pass + automatic continuation when the model hits its output limit
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
      await fail(err?.code ?? 'upstream', err?.message ?? 'LLM failed')
      return
    }

    if (!full.trim()) return fail('empty', 'لم يصل رد من النموذج. حاول مرة أخرى أو بدّل النموذج.')
    if (looksLikeProviderError(full)) return fail('provider', full.trim())

    const tokens = estimateTokens(full)
    await db.addMessage(DB, convId, 'assistant', full, tokens)
    await db.touchConversation(DB, convId)
    await db.bumpUsage(DB, userId, tokens + estimateTokens(userText))

    // Background tasks: title + memory extraction (cheap model, failures ignored)
    let title: string | undefined
    if (isFirstTurn && !regenerate) {
      try {
        const t = await chatOnce(llm.env, cheapModel, [
          { role: 'system', content: 'Generate a very short project/conversation title (max 6 words) in the same language as the user message. Reply with the title only — no quotes, no trailing punctuation.' },
          { role: 'user', content: `User: ${userText.slice(0, 600)}\nAssistant: ${full.slice(0, 400)}` },
        ])
        title = t.trim().split('\n')[0].replace(/^["'«»#*\s]+|["'«»*\s]+$/g, '').slice(0, 80)
        if (title) await db.updateConversation(DB, convId, userId, { title })
      } catch {}
    }
    if (!regenerate && userText.length > 15 && !attachments.length) {
      try {
        const raw = await chatOnce(llm.env, cheapModel, [
          { role: 'system', content: `Extract durable facts about the USER that would help in future coding sessions: name, OS, skill level, preferred stack/languages, project names & what they're building, tools/hosting/DB they use, accounts or API keys they own (never the key itself), language preference. Ignore one-off questions and code content. Return ONLY a JSON array of short strings in the user's language, max 3 items. If nothing durable, return [].` },
          { role: 'user', content: userText.slice(0, 4000) },
        ])
        const match = raw.match(/\[[\s\S]*\]/)
        if (match) {
          const facts: unknown = JSON.parse(match[0])
          if (Array.isArray(facts)) for (const f of facts.slice(0, 3)) if (typeof f === 'string' && f.trim().length > 3) await db.addMemory(DB, userId, f.trim().slice(0, 300), convId)
        }
      } catch {}
    }

    await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversation_id: convId, title, tokens }) })
  })
})

app.notFound((c) => c.json({ error: 'not found' }, 404))
export default app
