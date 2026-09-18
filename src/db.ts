// D1 data access layer
export type Conversation = {
  id: string
  user_id: string
  title: string
  persona: string
  model: string
  pinned: number
  created_at: string
  updated_at: string
}
export type Message = {
  id: number
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokens: number
  created_at: string
}
export type Memory = { id: number; user_id: string; fact: string; created_at: string }

export function uid(len = 16) {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const db = {
  async listConversations(DB: D1Database, userId: string) {
    const { results } = await DB.prepare(
      `SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 200`
    )
      .bind(userId)
      .all<Conversation>()
    return results
  },

  async getConversation(DB: D1Database, id: string, userId: string) {
    return DB.prepare(`SELECT * FROM conversations WHERE id = ? AND user_id = ?`).bind(id, userId).first<Conversation>()
  },

  async createConversation(DB: D1Database, userId: string, persona: string, model: string) {
    const id = uid(12)
    await DB.prepare(`INSERT INTO conversations (id, user_id, persona, model) VALUES (?, ?, ?, ?)`)
      .bind(id, userId, persona, model)
      .run()
    return (await this.getConversation(DB, id, userId))!
  },

  async updateConversation(
    DB: D1Database,
    id: string,
    userId: string,
    patch: Partial<Pick<Conversation, 'title' | 'persona' | 'model' | 'pinned'>>
  ) {
    const fields: string[] = []
    const values: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      fields.push(`${k} = ?`)
      values.push(v)
    }
    if (!fields.length) return
    values.push(id, userId)
    await DB.prepare(`UPDATE conversations SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run()
  },

  async touchConversation(DB: D1Database, id: string) {
    await DB.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  },

  async deleteConversation(DB: D1Database, id: string, userId: string) {
    await DB.batch([
      DB.prepare(`DELETE FROM messages WHERE conversation_id = ?`).bind(id),
      DB.prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).bind(id, userId),
    ])
  },

  async listMessages(DB: D1Database, conversationId: string, limit = 500) {
    const { results } = await DB.prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?`
    )
      .bind(conversationId, limit)
      .all<Message>()
    return results
  },

  async addMessage(DB: D1Database, conversationId: string, role: Message['role'], content: string, tokens: number) {
    const r = await DB.prepare(`INSERT INTO messages (conversation_id, role, content, tokens) VALUES (?, ?, ?, ?)`)
      .bind(conversationId, role, content, tokens)
      .run()
    return r.meta.last_row_id
  },

  async deleteMessagesFrom(DB: D1Database, conversationId: string, fromId: number) {
    await DB.prepare(`DELETE FROM messages WHERE conversation_id = ? AND id >= ?`).bind(conversationId, fromId).run()
  },

  async listMemories(DB: D1Database, userId: string) {
    const { results } = await DB.prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY id DESC LIMIT 50`)
      .bind(userId)
      .all<Memory>()
    return results
  },

  async addMemory(DB: D1Database, userId: string, fact: string, sourceConv?: string) {
    // avoid exact duplicates
    const exists = await DB.prepare(`SELECT id FROM memories WHERE user_id = ? AND fact = ?`).bind(userId, fact).first()
    if (exists) return
    await DB.prepare(`INSERT INTO memories (user_id, fact, source_conversation_id) VALUES (?, ?, ?)`)
      .bind(userId, fact, sourceConv ?? null)
      .run()
  },

  async deleteMemory(DB: D1Database, id: number, userId: string) {
    await DB.prepare(`DELETE FROM memories WHERE id = ? AND user_id = ?`).bind(id, userId).run()
  },

  async clearMemories(DB: D1Database, userId: string) {
    await DB.prepare(`DELETE FROM memories WHERE user_id = ?`).bind(userId).run()
  },

  async bumpUsage(DB: D1Database, userId: string, tokens: number) {
    await DB.prepare(
      `INSERT INTO usage_stats (user_id, total_messages, total_tokens, last_active) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET total_messages = total_messages + 1, total_tokens = total_tokens + excluded.total_tokens, last_active = CURRENT_TIMESTAMP`
    )
      .bind(userId, tokens)
      .run()
  },

  async getStats(DB: D1Database, userId: string) {
    const stats = await DB.prepare(`SELECT * FROM usage_stats WHERE user_id = ?`).bind(userId).first<any>()
    const convs = await DB.prepare(`SELECT COUNT(*) as n FROM conversations WHERE user_id = ?`).bind(userId).first<any>()
    const mems = await DB.prepare(`SELECT COUNT(*) as n FROM memories WHERE user_id = ?`).bind(userId).first<any>()
    return {
      total_messages: stats?.total_messages ?? 0,
      total_tokens: stats?.total_tokens ?? 0,
      conversations: convs?.n ?? 0,
      memories: mems?.n ?? 0,
    }
  },
}
