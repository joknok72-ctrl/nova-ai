/* NOVA CODE local store — IndexedDB, 100% on-device. No server storage. */
window.N = window.N || {}
;(() => {
  const DB_NAME = 'nova_code', DB_VER = 1
  let dbp = null
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('conversations')) { const c = d.createObjectStore('conversations', { keyPath: 'id' }); c.createIndex('updated_at', 'updated_at') }
      if (!d.objectStoreNames.contains('messages')) { const m = d.createObjectStore('messages', { keyPath: 'id', autoIncrement: true }); m.createIndex('conv', 'conversation_id') }
      if (!d.objectStoreNames.contains('memories')) d.createObjectStore('memories', { keyPath: 'id', autoIncrement: true })
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' })
    }
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  }))
  const tx = async (names, mode, fn) => {
    const d = await open(); const t = d.transaction(names, mode)
    const stores = Object.fromEntries([].concat(names).map((n) => [n, t.objectStore(n)]))
    const out = await fn(stores)
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error) })
    return out
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
  const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')

  const store = {
    async listConversations() {
      const all = await tx('conversations', 'readonly', (s) => req(s.conversations.getAll()))
      return all.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at > a.updated_at ? 1 : -1))
    },
    getConversation(id) { return tx('conversations', 'readonly', (s) => req(s.conversations.get(id))) },
    async createConversation(model) {
      const c = { id: uid(), title: 'مشروع جديد', model, pinned: 0, created_at: now(), updated_at: now() }
      await tx('conversations', 'readwrite', (s) => req(s.conversations.put(c)))
      return c
    },
    async updateConversation(id, patch) {
      return tx('conversations', 'readwrite', async (s) => {
        const c = await req(s.conversations.get(id)); if (!c) return null
        Object.assign(c, patch, { updated_at: now() }); await req(s.conversations.put(c)); return c
      })
    },
    async deleteConversation(id) {
      await tx(['conversations', 'messages'], 'readwrite', async (s) => {
        await req(s.conversations.delete(id))
        const keys = await req(s.messages.index('conv').getAllKeys(id))
        for (const k of keys) await req(s.messages.delete(k))
      })
    },
    async listMessages(convId) {
      const m = await tx('messages', 'readonly', (s) => req(s.messages.index('conv').getAll(convId)))
      return m.sort((a, b) => a.id - b.id)
    },
    addMessage(convId, role, content, tokens = 0) {
      return tx(['messages', 'conversations'], 'readwrite', async (s) => {
        const id = await req(s.messages.add({ conversation_id: convId, role, content, tokens, created_at: now() }))
        const c = await req(s.conversations.get(convId)); if (c) { c.updated_at = now(); await req(s.conversations.put(c)) }
        return id
      })
    },
    deleteMessagesFrom(convId, fromId) {
      return tx('messages', 'readwrite', async (s) => { const keys = await req(s.messages.index('conv').getAllKeys(convId)); for (const k of keys) if (k >= fromId) await req(s.messages.delete(k)) })
    },
    async listMemories() { const m = await tx('memories', 'readonly', (s) => req(s.memories.getAll())); return m.sort((a, b) => b.id - a.id) },
    async addMemory(fact) {
      fact = fact.trim(); if (!fact) return
      return tx('memories', 'readwrite', async (s) => {
        const all = await req(s.memories.getAll()); if (all.some((m) => m.fact === fact)) return
        await req(s.memories.add({ fact, created_at: now() }))
      })
    },
    deleteMemory(id) { return tx('memories', 'readwrite', (s) => req(s.memories.delete(id))) },
    clearMemories() { return tx('memories', 'readwrite', (s) => req(s.memories.clear())) },
    async getKV(key, def) { const r = await tx('kv', 'readonly', (s) => req(s.kv.get(key))); return r ? r.value : def },
    setKV(key, value) { return tx('kv', 'readwrite', (s) => req(s.kv.put({ key, value }))) },
    async bumpUsage(tokens) { const u = await this.getKV('usage', { total_messages: 0, total_tokens: 0 }); u.total_messages++; u.total_tokens += tokens; await this.setKV('usage', u) },
    async stats() {
      const [convs, mems, u] = await Promise.all([this.listConversations(), this.listMemories(), this.getKV('usage', { total_messages: 0, total_tokens: 0 })])
      return { conversations: convs.length, memories: mems.length, total_messages: u.total_messages, total_tokens: u.total_tokens }
    },
    // Full backup / restore (JSON)
    async exportAll() {
      const [conversations, memories, usage] = await Promise.all([this.listConversations(), this.listMemories(), this.getKV('usage', null)])
      const messages = await tx('messages', 'readonly', (s) => req(s.messages.getAll()))
      return { version: 1, exported_at: now(), conversations, messages, memories, usage, settings: JSON.parse(localStorage.getItem('nova_settings') || '{}') }
    },
    async importAll(data, { merge = true } = {}) {
      if (!data || data.version !== 1) throw new Error('ملف نسخة احتياطية غير صالح')
      await tx(['conversations', 'messages', 'memories', 'kv'], 'readwrite', async (s) => {
        if (!merge) { await req(s.conversations.clear()); await req(s.messages.clear()); await req(s.memories.clear()) }
        for (const c of data.conversations || []) await req(s.conversations.put(c))
        const idMap = {}
        for (const m of data.messages || []) { const { id, ...rest } = m; const nid = await req(s.messages.add(rest)); idMap[id] = nid }
        const existing = (await req(s.memories.getAll())).map((m) => m.fact)
        for (const m of data.memories || []) if (!existing.includes(m.fact)) await req(s.memories.add({ fact: m.fact, created_at: m.created_at || now() }))
        if (data.usage) await req(s.kv.put({ key: 'usage', value: data.usage }))
      })
      if (data.settings && Object.keys(data.settings).length) localStorage.setItem('nova_settings', JSON.stringify(data.settings))
    },
    async wipe() { await tx(['conversations', 'messages', 'memories', 'kv'], 'readwrite', async (s) => { for (const k of ['conversations', 'messages', 'memories', 'kv']) await req(s[k].clear()) }) },
  }
  window.N.store = store
})()
