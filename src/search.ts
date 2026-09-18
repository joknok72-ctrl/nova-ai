// Free web search (no API key) via DuckDuckGo HTML + page fetch for the model's tool use.
export type SearchResult = { title: string; url: string; snippet: string }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function decode(s: string) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function ddg(q: string, max: number): Promise<SearchResult[]> {
  const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8' } })
  if (!res.ok) return []
  const html = await res.text()
  const out: SearchResult[] = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m
  while ((m = re.exec(html)) && out.length < max) {
    let url = m[1]
    const uddg = url.match(/uddg=([^&]+)/)
    if (uddg) url = decodeURIComponent(uddg[1])
    if (url.startsWith('//')) url = 'https:' + url
    if (!/^https?:/.test(url) || /duckduckgo\.com/.test(url)) continue
    out.push({ title: decode(m[2]), url, snippet: decode(m[3]) })
  }
  return out
}

async function bing(q: string, max: number): Promise<SearchResult[]> {
  const res = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=en&count=10&form=QBLH', { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SRCHHPGUSR=ADLT=OFF' } })
  if (!res.ok) return []
  const html = await res.text()
  const out: SearchResult[] = []
  // split per result block; tolerant to layout changes
  const blocks = html.split('<li class="b_algo"').slice(1)
  for (const b of blocks) {
    if (out.length >= max) break
    const a = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!a) continue
    let url = a[1].replace(/&amp;/g, '&')
    // Bing wraps in a redirect: /ck/a?...&u=a1<base64url>
    const u = url.match(/[?&]u=a1([^&]+)/)
    if (u) { try { url = atob(u[1].replace(/-/g, '+').replace(/_/g, '/')) } catch {} }
    if (!/^https?:/.test(url) || /bing\.com|go\.microsoft\.com/.test(url)) continue
    const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/) || b.match(/class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/)
    out.push({ title: decode(a[2]), url, snippet: decode(p ? p[1] : '').replace(/^Web\s*/i, '') })
  }
  return out
}

async function brave(q: string, max: number): Promise<SearchResult[]> {
  const res = await fetch('https://search.brave.com/search?q=' + encodeURIComponent(q) + '&source=web', { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } })
  if (!res.ok) return []
  const html = await res.text()
  const out: SearchResult[] = []
  const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="[^"]*\bh\b[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]*?)<\/div>/g
  let m
  while ((m = re.exec(html)) && out.length < max) {
    if (/brave\.com/.test(m[1])) continue
    out.push({ title: decode(m[2]), url: m[1], snippet: decode(m[3]) })
  }
  return out
}

/** Try several engines (datacenter IPs get blocked by some). First non-empty wins. */
export async function webSearch(query: string, max = 6): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 300)
  if (!q) return []
  const engines = [bing, ddg, brave]
  for (const e of engines) {
    try { const r = await e(q, max); if (r.length) return r } catch {}
  }
  // last resort: run all in parallel once more
  const all = await Promise.allSettled(engines.map((e) => e(q, max)))
  for (const r of all) if (r.status === 'fulfilled' && r.value.length) return r.value
  return []
}

/** Fetch a page and return readable text (scripts/styles stripped), capped. */
export async function fetchPage(url: string, maxChars = 12000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('invalid url')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json,text/plain,*/*' }, signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const ct = res.headers.get('content-type') || ''
    let text = await res.text()
    if (/html/.test(ct) || /<html/i.test(text.slice(0, 500))) {
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<(br|p|div|li|h[1-6]|tr|pre)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
      text = decode(text).replace(/\n{3,}/g, '\n\n')
    }
    return text.slice(0, maxChars)
  } finally { clearTimeout(t) }
}

// --- Tool protocol: the model emits a single-line JSON command; we run it and feed results back. ---
export const TOOLS_PROMPT = `
# Web tools (use ONLY when genuinely needed)
You can access the internet. When you need current information you don't reliably know — latest library versions, a new API, an unfamiliar error message, documentation, prices, current events — emit a tool call as the ONLY content of your reply, on one line:
<<TOOL>>{"tool":"search","query":"..."}<</TOOL>>
or to read a page:
<<TOOL>>{"tool":"fetch","url":"https://..."}<</TOOL>>
Results will be returned to you in a "TOOL RESULT" message; then continue normally (you may call tools up to 4 times per answer). Do NOT call tools for things you already know well (basic syntax, common libraries, standard patterns). Never mention the tool mechanics to the user; just use what you learned and cite the source URL briefly when it matters.`

export function parseToolCall(text: string): { tool: 'search'; query: string } | { tool: 'fetch'; url: string } | null {
  const m = text.trim().match(/^<<TOOL>>([\s\S]*?)<<\/TOOL>>\s*$/)
  if (!m) return null
  try {
    const j = JSON.parse(m[1].trim())
    if (j.tool === 'search' && typeof j.query === 'string') return { tool: 'search', query: j.query }
    if (j.tool === 'fetch' && typeof j.url === 'string') return { tool: 'fetch', url: j.url }
  } catch {}
  return null
}
