// Provider registry + live model discovery.
// Every provider here exposes an OpenAI-compatible /chat/completions endpoint.

export type ProviderId = 'gemini' | 'openai' | 'groq' | 'openrouter' | 'deepseek' | 'mistral' | 'together' | 'xai' | 'anthropic' | 'custom'

export type ProviderInfo = {
  id: ProviderId
  name: string
  baseUrl: string
  keyUrl: string
  free: boolean
  note: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'gemini', name: 'Google Gemini (AI Studio)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/app/apikey', free: true, note: 'مجاني — يجلب كل نماذج حسابك تلقائياً' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', free: true, note: 'مجاني وسريع جداً (Llama, Qwen, DeepSeek)' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', free: true, note: 'مئات النماذج — بعضها مجاني' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', free: false, note: 'GPT-4o, o-series' },
  { id: 'anthropic', name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys', free: false, note: 'Claude Sonnet / Opus' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', free: false, note: 'رخيص جداً وقوي في الكود' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', free: true, note: 'Codestral مجاني للتجربة' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.xyz/settings/api-keys', free: false, note: 'نماذج مفتوحة المصدر' },
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai', free: false, note: 'Grok' },
  { id: 'custom', name: 'مزود مخصص (OpenAI-compatible)', baseUrl: '', keyUrl: '', free: false, note: 'Ollama, LM Studio, vLLM, أي Base URL' },
]

export function detectProvider(baseUrl: string): ProviderId {
  const u = (baseUrl || '').toLowerCase()
  if (u.includes('googleapis.com')) return 'gemini'
  if (u.includes('api.openai.com')) return 'openai'
  if (u.includes('groq.com')) return 'groq'
  if (u.includes('openrouter.ai')) return 'openrouter'
  if (u.includes('deepseek.com')) return 'deepseek'
  if (u.includes('mistral.ai')) return 'mistral'
  if (u.includes('together.xyz')) return 'together'
  if (u.includes('x.ai')) return 'xai'
  if (u.includes('anthropic.com')) return 'anthropic'
  return 'custom'
}

export type DiscoveredModel = {
  id: string
  name: string
  desc: string
  context?: number
  recommended?: boolean // good default for coding
  tier: 'top' | 'fast' | 'other'
}

// Rank models for coding: higher is better.
function scoreModel(id: string): number {
  const s = id.toLowerCase()
  let score = 0
  if (/codex|coder|code/.test(s)) score += 50
  if (/gpt-5|o3|o4|opus|sonnet|gemini-2\.5-pro|gemini-3|gemini-2\.5|pro/.test(s)) score += 40
  if (/preview|exp|latest/.test(s)) score += 5
  if (/gpt-4o|4\.1|flash|70b|72b|deepseek-chat|deepseek-reasoner|r1|qwen.*coder|llama-3\.3|codestral|mistral-large|grok-3|grok-4/.test(s)) score += 25
  if (/mini|nano|lite|8b|small|1b|3b|tiny|instant/.test(s)) score -= 15
  if (/embedding|embed|tts|whisper|audio|image|vision-only|imagen|veo|aqa|moderation|realtime|transcribe|dall|search|guard|bison|gecko|learnlm|robotics|native-audio|live/.test(s)) score -= 200
  if (/gemini-1\.0|gemini-1\.5|gpt-3\.5|davinci|babbage|curie|instruct/.test(s)) score -= 30
  return score
}

function humanName(id: string): string {
  return id
    .replace(/^models\//, '')
    .replace(/^(google|openai|anthropic|meta-llama|deepseek|qwen|mistralai)\//, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Gpt/g, 'GPT')
}

/**
 * Discover models from any provider. Uses the OpenAI-compatible GET /models where available,
 * with provider-specific fallbacks (Gemini native API returns richer metadata).
 */
export async function discoverModels(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const provider = detectProvider(baseUrl)
  const base = baseUrl.replace(/\/$/, '')
  let raw: { id: string; name?: string; desc?: string; context?: number; methods?: string[] }[] = []

  if (provider === 'gemini') {
    // Native endpoint: returns ALL models available to this key incl. new/preview ones, with metadata.
    const all: any[] = []
    let pageToken = ''
    for (let i = 0; i < 10; i++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`
      const r = await fetch(url, { headers: { 'x-goog-api-key': apiKey } })
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const j: any = await r.json()
      all.push(...(j.models || []))
      pageToken = j.nextPageToken || ''
      if (!pageToken) break
    }
    raw = all
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({
        id: String(m.name).replace(/^models\//, ''),
        name: m.displayName || humanName(m.name),
        desc: m.description || '',
        context: m.inputTokenLimit,
        methods: m.supportedGenerationMethods,
      }))
  } else if (provider === 'anthropic') {
    const r = await fetch(`${base}/models?limit=1000`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } })
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j: any = await r.json()
    raw = (j.data || []).map((m: any) => ({ id: m.id, name: m.display_name || humanName(m.id), desc: '' }))
  } else {
    const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!r.ok) throw new Error(`${provider} ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j: any = await r.json()
    const list: any[] = Array.isArray(j) ? j : j.data || j.models || []
    raw = list.map((m: any) => ({
      id: String(m.id || m.name),
      name: m.name && m.name !== m.id ? m.name : humanName(String(m.id || m.name)),
      desc: m.description || (m.owned_by ? `by ${m.owned_by}` : ''),
      context: m.context_length || m.context_window,
    }))
  }

  // de-dupe, score, sort
  const seen = new Set<string>()
  const models: DiscoveredModel[] = []
  for (const m of raw) {
    if (!m.id || seen.has(m.id)) continue
    seen.add(m.id)
    const score = scoreModel(m.id)
    if (score <= -100) continue // non-chat models
    models.push({
      id: m.id,
      name: m.name || humanName(m.id),
      desc: (m.desc || '').slice(0, 140),
      context: m.context,
      tier: score >= 40 ? 'top' : score >= 10 ? 'fast' : 'other',
    })
  }
  models.sort((a, b) => scoreModel(b.id) - scoreModel(a.id) || a.id.localeCompare(b.id))
  if (models[0]) models[0].recommended = true
  return models
}

/** Pick a cheap/fast model from a discovered list for background tasks (titles, memory). */
export function pickCheapModel(models: DiscoveredModel[], fallback: string): string {
  const fast = models.find((m) => /flash-lite|mini|nano|8b|instant|haiku|small/.test(m.id.toLowerCase()) && !/thinking/.test(m.id))
    || models.find((m) => /flash|4o-mini|small/.test(m.id.toLowerCase()))
  return fast?.id || fallback
}
