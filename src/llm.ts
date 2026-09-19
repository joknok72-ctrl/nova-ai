// Multi-provider LLM client (fetch-only, Cloudflare Workers compatible).
// Speaks OpenAI-compatible chat/completions for everyone, and Anthropic's native Messages API for Claude.
import { detectProvider } from './providers'

export type ImagePart = { type: 'image'; dataUrl: string } // data:image/png;base64,...
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; images?: ImagePart[] }

/** OpenAI-compatible content: string, or parts array when images are present */
function toOpenAIContent(m: ChatMessage): any {
  if (!m.images?.length) return m.content
  return [{ type: 'text', text: m.content || 'See the attached image(s).' }, ...m.images.map((im) => ({ type: 'image_url', image_url: { url: im.dataUrl } }))]
}

/** fetch with retry on 429/5xx (exponential backoff, honors Retry-After) */
export async function fetchRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let last: Response | null = null
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, init)
    if (res.status !== 429 && res.status < 500) return res
    last = res
    if (i < tries - 1) {
      const ra = Number(res.headers.get('retry-after'))
      await new Promise((r) => setTimeout(r, Math.min(8000, ra > 0 ? ra * 1000 : 800 * 2 ** i)))
    }
  }
  return last!
}
export type LLMEnv = { OPENAI_API_KEY: string; OPENAI_BASE_URL?: string }

export class LLMError extends Error {
  code: string
  status?: number
  constructor(code: string, message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

function baseUrl(env: LLMEnv) {
  return (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
}

/** Some proxies return billing/quota errors as a normal 200 text reply. Detect them. */
export function looksLikeProviderError(text: string) {
  const t = text.trim()
  if (t.length > 400) return false
  return /credits? can't be used|credit_exhausted|insufficient[_ ]quota|exceeded your current quota|invalid[_ ]api[_ ]key|incorrect api key|rate limit|RESOURCE_EXHAUSTED/i.test(t)
}

function classify(status: number, text: string): LLMError {
  const short = text.slice(0, 300)
  if (status === 401 || status === 403) return new LLMError('auth', `مفتاح API غير صالح أو بدون صلاحية (${status}). ${short}`, status)
  if (status === 402) return new LLMError('billing', `الرصيد منتهي (402). ${short}`, status)
  if (status === 429) return new LLMError('rate_limit', `تم تجاوز الحد المسموح (429) — انتظر قليلاً أو بدّل النموذج/المزود. ${short}`, status)
  if (status === 404) return new LLMError('model', `النموذج غير موجود أو غير متاح لمفتاحك (404). ${short}`, status)
  if (status >= 500) return new LLMError('upstream', `خطأ من المزود (${status}). حاول مرة أخرى. ${short}`, status)
  return new LLMError('upstream', `LLM error ${status}: ${short}`, status)
}

// Model-specific request shaping for OpenAI-compatible endpoints
function shapeBody(model: string, messages: ChatMessage[], stream: boolean, provider: string) {
  const body: any = { model, messages: messages.map((m) => ({ role: m.role, content: toOpenAIContent(m) })), stream }
  const m = model.toLowerCase()
  // Newer OpenAI reasoning models reject temperature; most others accept it.
  if (!/^(o\d|gpt-5)/.test(m)) body.temperature = 0.3
  // Encourage long, complete outputs where supported
  if (provider === 'openai' && /^(o\d|gpt-5)/.test(m)) body.max_completion_tokens = 32000
  else if (provider !== 'gemini') body.max_tokens = /claude|deepseek|qwen|llama|mixtral|gemma|codestral|grok/.test(m) ? 16000 : 16000
  if (stream && (provider === 'openai' || provider === 'openrouter' || provider === 'groq')) body.stream_options = { include_usage: true }
  return body
}

// ---------------- OpenAI-compatible ----------------
async function openaiStream(env: LLMEnv, model: string, messages: ChatMessage[], provider: string): Promise<Response> {
  const res = await fetchRetry(`${baseUrl(env)}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'HTTP-Referer': 'https://nova-code.pages.dev', 'X-Title': 'NOVA CODE' },
    body: JSON.stringify(shapeBody(model, messages, true, provider)),
  })
  if (!res.ok || !res.body) throw classify(res.status, await res.text().catch(() => ''))
  return res
}

async function openaiOnce(env: LLMEnv, model: string, messages: ChatMessage[], provider: string): Promise<string> {
  const res = await fetchRetry(`${baseUrl(env)}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(shapeBody(model, messages, false, provider)),
  })
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ''))
  const data: any = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

// ---------------- Anthropic native ----------------
function toAnthropic(messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = messages.filter((m) => m.role !== 'system').map((m) => {
    if (!m.images?.length) return { role: m.role, content: m.content }
    const parts: any[] = m.images.map((im) => { const mm = im.dataUrl.match(/^data:([^;]+);base64,(.+)$/); return { type: 'image', source: { type: 'base64', media_type: mm?.[1] || 'image/png', data: mm?.[2] || '' } } })
    parts.push({ type: 'text', text: m.content || 'See the attached image(s).' })
    return { role: m.role, content: parts }
  })
  return { system, messages: rest }
}

async function anthropicStream(env: LLMEnv, model: string, messages: ChatMessage[]): Promise<Response> {
  const { system, messages: msgs } = toAnthropic(messages)
  const res = await fetchRetry(`${baseUrl(env)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.OPENAI_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, system, messages: msgs, max_tokens: 16000, stream: true }),
  })
  if (!res.ok || !res.body) throw classify(res.status, await res.text().catch(() => ''))
  return res
}

async function anthropicOnce(env: LLMEnv, model: string, messages: ChatMessage[]): Promise<string> {
  const { system, messages: msgs } = toAnthropic(messages)
  const res = await fetchRetry(`${baseUrl(env)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.OPENAI_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, system, messages: msgs, max_tokens: 1024 }),
  })
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ''))
  const data: any = await res.json()
  return (data?.content || []).map((c: any) => c.text || '').join('')
}

// ---------------- Public API ----------------
export async function chatStream(env: LLMEnv, model: string, messages: ChatMessage[]): Promise<Response> {
  const provider = detectProvider(baseUrl(env))
  return provider === 'anthropic' ? anthropicStream(env, model, messages) : openaiStream(env, model, messages, provider)
}

export async function chatOnce(env: LLMEnv, model: string, messages: ChatMessage[]): Promise<string> {
  const provider = detectProvider(baseUrl(env))
  return provider === 'anthropic' ? anthropicOnce(env, model, messages) : openaiOnce(env, model, messages, provider)
}

/**
 * Parse an SSE stream (OpenAI or Anthropic format) and call onDelta for every text chunk.
 * Returns { text, finish } where finish is 'length' when the model was cut off (so we can auto-continue).
 */
export async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onDelta: (t: string) => void | Promise<void>
): Promise<{ text: string; finish: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finish = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        // OpenAI
        const choice = json?.choices?.[0]
        if (choice) {
          const delta = choice.delta?.content
          if (delta) {
            full += delta
            await onDelta(delta)
          }
          if (choice.finish_reason) finish = choice.finish_reason
          continue
        }
        // Anthropic
        if (json?.type === 'content_block_delta' && json.delta?.text) {
          full += json.delta.text
          await onDelta(json.delta.text)
        } else if (json?.type === 'message_delta' && json.delta?.stop_reason) {
          finish = json.delta.stop_reason === 'max_tokens' ? 'length' : json.delta.stop_reason
        } else if (json?.error) {
          throw new LLMError('upstream', json.error.message || 'stream error')
        }
      } catch (e) {
        if (e instanceof LLMError) throw e
        /* ignore partial json */
      }
    }
  }
  return { text: full, finish }
}

// Rough token estimate (good enough for stats/trimming)
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.5)
}
