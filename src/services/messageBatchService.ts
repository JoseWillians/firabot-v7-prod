const processedMessageIds = new Map<string, number>()

/**
 * Processa o lote do Baileys em ordem para não perder mensagens quando um
 * único evento messages.upsert trouxer mais de um item.
 */
export async function processMessageBatch<T>(
  messages: T[],
  handler: (message: T) => Promise<void>,
  onError?: (error: unknown, message: T) => Promise<void> | void
) {
  for (const message of messages) {
    try {
      await handler(message)
    } catch (error) {
      if (!onError) throw error
      await onError(error, message)
    }
  }
}

/**
 * Deduplica reentregas pelo ID fornecido pelo WhatsApp. Entradas expiradas são
 * removidas durante o uso para limitar o crescimento do cache em memória.
 */
export function shouldProcessMessageId(messageId: string | null | undefined, now = Date.now(), ttlMs = 10 * 60 * 1000) {
  if (!messageId) return true

  for (const [storedId, storedAt] of processedMessageIds) {
    if (now - storedAt > ttlMs) processedMessageIds.delete(storedId)
  }

  const previous = processedMessageIds.get(messageId)
  if (previous !== undefined && now - previous <= ttlMs) return false

  processedMessageIds.set(messageId, now)
  return true
}

export function clearProcessedMessageIds() {
  processedMessageIds.clear()
}
