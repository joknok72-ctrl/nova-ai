// Thin OpenAI-compatible client using fetch (works on Cloudflare Workers).
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LLMEnv = { OPENAI_API_KEY: string; OPENAI_BASE_URL?: string }

function baseUrl(env: LLMEnv) {
  return (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
}

/** Some proxies return billing/quota errors as a normal 200 text reply. Detect them. */
export function looksLikeProviderError(text: string) {
  const t = text.trim()
  if (t.length > 400) return false
  return /credits? can't be used|credit_exhausted|insufficient[_ ]quota|exceeded your current quota|invalid[_ ]api[_ ]key|incorrect api key|rate limit/i.test(t)
}

export class LLMError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function chatStream(env: LLMEnv, model: string, messages: ChatMessage[]): Promise<Response> {
  const res = await fetch(`${baseUrl(env)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new LLMError(res.status === 401 || res.status === 403 || res.status === 402 ? 'auth' : 'upstream', `LLM error ${res.status}: ${text.slice(0, 300)}`)
  }
  return res
}

export async function chatOnce(env: LLMEnv, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${baseUrl(env)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 300)}`)
  }
  const data: any = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

/**
 * Parse an OpenAI SSE stream and call onDelta for every text chunk.
 * Returns the full accumulated text.
 */
export async function consumeSSE(body: ReadableStream<Uint8Array>, onDelta: (t: string) => void | Promise<void>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
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
        const delta = json?.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          await onDelta(delta)
        }
      } catch {
        /* ignore partial json */
      }
    }
  }
  return full
}

// Rough token estimate (good enough for stats/trimming)
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.5)
}
