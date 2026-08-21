import { config } from '../config.js'

const lastResponses = new Map<string, number>()

/**
 * Anti-spam simples para mensagens repetidas.
 * A chave é definida pelo chamador; no fluxo principal usamos usuário + texto,
 * assim opções diferentes em sequência continuam funcionando.
 */
export function canRespondToUser(userJid: string, now = Date.now()) {
  const lastResponse = lastResponses.get(userJid) || 0
  if (now - lastResponse < config.spamWindowMs) return false

  lastResponses.set(userJid, now)
  return true
}

export function clearSpamGuard() {
  lastResponses.clear()
}
