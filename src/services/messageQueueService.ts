export class ConversationQueueFullError extends Error {
  readonly code = 429

  constructor() {
    super('Fila de conversa temporariamente cheia')
    this.name = 'ConversationQueueFullError'
  }
}

interface ConversationQueueOptions {
  maxConversations?: number
  maxPendingPerConversation?: number
}

interface QueueEntry {
  tail: Promise<void>
  depth: number
}

/** Serializa mensagens por conversa e limita trabalho aguardando em memoria. */
export function createConversationQueue(options: ConversationQueueOptions = {}) {
  const maxConversations = options.maxConversations ?? 1000
  const maxPendingPerConversation = options.maxPendingPerConversation ?? 50
  if (!Number.isInteger(maxConversations) || maxConversations < 1 ||
      !Number.isInteger(maxPendingPerConversation) || maxPendingPerConversation < 1) {
    throw new Error('Limites da fila de conversas devem ser inteiros positivos')
  }

  const queues = new Map<string, QueueEntry>()

  const run = async (jid: string, action: () => Promise<void>): Promise<void> => {
    let entry = queues.get(jid)
    if (!entry) {
      if (queues.size >= maxConversations) throw new ConversationQueueFullError()
      entry = { tail: Promise.resolve(), depth: 0 }
      queues.set(jid, entry)
    }
    if (entry.depth >= maxPendingPerConversation) throw new ConversationQueueFullError()

    entry.depth++
    const work = entry.tail.then(action)
    entry.tail = work.then(() => undefined, () => undefined)
    try {
      await work
    } finally {
      entry.depth--
      if (entry.depth === 0 && queues.get(jid) === entry) queues.delete(jid)
    }
  }

  return { run }
}

const conversationQueue = createConversationQueue()

export function runInConversationQueue(jid: string, action: () => Promise<void>): Promise<void> {
  return conversationQueue.run(jid, action)
}
