import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import { db, uid } from './db'
import { chatStream, chatOnce, consumeSSE, estimateTokens, looksLikeProviderError, type ChatMessage, type LLMEnv } from './llm'
import { PERSONAS, DEFAULT_PERSONA, MODELS, DEFAULT_MODEL, ALLOWED_MODELS } from './personas'
import { page } from './page'

type Bindings = {
  DB: D1Database
  OPENAI_API_KEY: string
  OPENAI_BASE_URL?: string
}
type Variables = { userId: string }

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors())

// ---------- Identity: anonymous, cookie-based (no signup needed) ----------
app.use('*', async (c, next) => {
  let userId = getCookie(c, 'nova_uid')
  if (!userId || !/^[a-f0-9]{32}$/.test(userId)) {
    userId = uid(16)
    setCookie(c, 'nova_uid', userId, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 365,
    })
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
    defaults: { persona: DEFAULT_PERSONA, model: DEFAULT_MODEL },
    stats,
  })
})

// ---------- Conversations ----------
app.get('/api/conversations', async (c) => {
  const list = await db.listConversations(c.env.DB, c.get('userId'))
  return c.json(list)
})

app.post('/api/conversations', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const persona = PERSONAS[body.persona] ? body.persona : DEFAULT_PERSONA
  const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL
  const conv = await db.createConversation(c.env.DB, c.get('userId'), persona, model)
  return c.json(conv, 201)
})

app.get('/api/conversations/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'), c.get('userId'))
  if (!conv) return c.json({ error: 'not found' }, 404)
  const messages = await db.listMessages(c.env.DB, conv.id)
  return c.json({ ...conv, messages })
})

app.patch('/api/conversations/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'), c.get('userId'))
  if (!conv) return c.json({ error: 'not found' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const patch: any = {}
  if (typeof body.title === 'string') patch.title = body.title.slice(0, 120)
  if (PERSONAS[body.persona]) patch.persona = body.persona
  if (ALLOWED_MODELS.has(body.model)) patch.model = body.model
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
const MAX_CONTEXT_TOKENS = 24000

function buildContext(systemPrompt: string, memories: string[], history: { role: string; content: string }[]): ChatMessage[] {
  let sys = systemPrompt
  if (memories.length) {
    sys += `\n\n## Known facts about the user\n` + memories.map((m) => `- ${m}`).join('\n')
  }
  sys += `\n\nCurrent date: ${new Date().toISOString().slice(0, 10)}`

  // Keep the most recent messages within the token budget
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

/**
 * Resolve which LLM credentials to use.
 * BYOK: the browser may send its own OpenAI-compatible key/base-url via headers
 * (stored only in the user's localStorage, never persisted server-side).
 */
function resolveLLM(c: any): { env: LLMEnv; byok: boolean; cheapModel: string } {
  const key = c.req.header('x-nova-key')
  const base = c.req.header('x-nova-base-url')
  if (key && key.length > 10) {
    const cheap = c.req.header('x-nova-cheap-model') || ''
    return { env: { OPENAI_API_KEY: key, OPENAI_BASE_URL: base || 'https://api.openai.com/v1' }, byok: true, cheapModel: cheap }
  }
  return { env: { OPENAI_API_KEY: c.env.OPENAI_API_KEY, OPENAI_BASE_URL: c.env.OPENAI_BASE_URL }, byok: false, cheapModel: 'gpt-5-mini' }
}

app.post('/api/chat', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({}))
  const content: string = (body.content ?? '').toString().trim()
  const regenerate: boolean = !!body.regenerate
  if (!content && !regenerate) return c.json({ error: 'content required' }, 400)
  if (content.length > 20000) return c.json({ error: 'message too long' }, 400)

  const llm = resolveLLM(c)
  if (!llm.env.OPENAI_API_KEY) return c.json({ error: 'no_api_key', message: 'لا يوجد مفتاح API. أضف مفتاحك من الإعدادات.' }, 400)

  const DB = c.env.DB
  // With BYOK any model name is allowed (user's own provider); otherwise restrict to our list
  const modelOk = (m: unknown) => typeof m === 'string' && m.length > 0 && m.length < 80 && (llm.byok || ALLOWED_MODELS.has(m))
  let conv = body.conversation_id ? await db.getConversation(DB, body.conversation_id, userId) : null
  if (!conv) {
    const persona = PERSONAS[body.persona] ? body.persona : DEFAULT_PERSONA
    const model = modelOk(body.model) ? body.model : DEFAULT_MODEL
    conv = await db.createConversation(DB, userId, persona, model)
  }
  const model = modelOk(body.model) ? body.model : conv.model
  const cheapModel = llm.cheapModel || model
  const persona = PERSONAS[conv.persona] ?? PERSONAS[DEFAULT_PERSONA]

  let history = await db.listMessages(DB, conv.id)

  let userMsgId = 0
  if (regenerate) {
    // drop the last assistant message (and re-answer the last user turn)
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
  const messages = buildContext(persona.systemPrompt, memories, history)
  const isFirstTurn = history.filter((m) => m.role === 'user').length === 1
  const convId = conv.id

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'meta', data: JSON.stringify({ conversation_id: convId, model, persona: persona.id }) })
    let full = ''
    const fail = async (code: string, message: string) => {
      // roll back the user's message so they can retry cleanly
      if (userMsgId) await db.deleteMessagesFrom(DB, convId, userMsgId).catch(() => {})
      const remaining = await db.listMessages(DB, convId, 1)
      if (!remaining.length) await db.deleteConversation(DB, convId, userId).catch(() => {})
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ code, message, conversation_deleted: !remaining.length }) })
    }
    try {
      const res = await chatStream(llm.env, model, messages)
      full = await consumeSSE(res.body!, async (delta) => {
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ t: delta }) })
      })
    } catch (err: any) {
      await fail(err?.code ?? 'upstream', err?.message ?? 'LLM failed')
      return
    }
    if (!full.trim()) {
      await fail('empty', 'لم يصل رد من النموذج. حاول مرة أخرى.')
      return
    }
    if (looksLikeProviderError(full)) {
      await fail('provider', full.trim())
      return
    }

    const tokens = estimateTokens(full)
    await db.addMessage(DB, convId, 'assistant', full, tokens)
    await db.touchConversation(DB, convId)
    await db.bumpUsage(DB, userId, tokens + estimateTokens(content))

    // Background-ish tasks: title generation + memory extraction on first turn
    let title: string | undefined
    if (isFirstTurn && !regenerate) {
      try {
        const t = await chatOnce(llm.env, cheapModel, [
          {
            role: 'system',
            content:
              'Generate a very short title (max 6 words) for this conversation, in the same language as the user message. Reply with the title only, no quotes, no punctuation at the end.',
          },
          { role: 'user', content: `User: ${content.slice(0, 500)}\nAssistant: ${full.slice(0, 500)}` },
        ])
        title = t.trim().replace(/^["'«»]+|["'«»]+$/g, '').slice(0, 80)
        if (title) await db.updateConversation(DB, convId, userId, { title })
      } catch {}
    }

    // Memory extraction (cheap model): pull durable facts about the user
    if (!regenerate && content.length > 15) {
      try {
        const raw = await chatOnce(llm.env, cheapModel, [
          {
            role: 'system',
            content: `Extract durable personal facts about the USER from their message that would be useful to remember in future conversations (name, job, location, preferences, goals, projects, skills, language preference). Ignore transient requests or questions. Return a JSON array of short strings in the user's language, max 3 items. If nothing durable, return [].`,
          },
          { role: 'user', content },
        ])
        const match = raw.match(/\[[\s\S]*\]/)
        if (match) {
          const facts: unknown = JSON.parse(match[0])
          if (Array.isArray(facts)) {
            for (const f of facts.slice(0, 3)) {
              if (typeof f === 'string' && f.trim().length > 3) await db.addMemory(DB, userId, f.trim().slice(0, 300), convId)
            }
          }
        }
      } catch {}
    }

    await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversation_id: convId, title, tokens }) })
  })
})

app.notFound((c) => c.json({ error: 'not found' }, 404))

export default app
