export interface WhatsAppMessageIdentity {
  key?: {
    remoteJid?: string | null
    remoteJidAlt?: string | null
    participant?: string | null
    participantAlt?: string | null
  } | null
}

/**
 * O WhatsApp pode identificar uma conversa pelo LID e enviar o número telefônico
 * no campo alternativo. Mantemos todos os candidatos para autorização e
 * persistência sem assumir que o trecho numérico de um @lid é um telefone.
 */
export function getMessageJidCandidates(message: WhatsAppMessageIdentity) {
  const key = message.key
  if (!key) return []

  return [
    ...new Set(
      [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt].filter((value): value is string =>
        Boolean(value)
      )
    )
  ]
}

/** Prefere a identidade PN disponível para serializar mensagens do mesmo contato,
 * mesmo quando um evento chega identificado pelo LID e outro pelo número.
 * Conversas em grupo mantêm o JID do grupo como chave.
 */
export function getConversationQueueKey(message: WhatsAppMessageIdentity) {
  const remoteJid = message.key?.remoteJid
  if (!remoteJid) return ''
  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return remoteJid

  return getMessageJidCandidates(message).find((jid) => jid.endsWith('@s.whatsapp.net')) || remoteJid
}

export function getPhoneE164FromJids(jids: string[]) {
  const phoneJid = jids.find((jid) => jid.endsWith('@s.whatsapp.net'))
  if (!phoneJid) return null

  const userPart = phoneJid.split('@')[0] || ''
  const digits = (userPart.split(':')[0] || userPart).replace(/\D/g, '')
  return digits || null
}

export function getJidDomain(jid: string) {
  return jid.includes('@') ? jid.split('@').pop() || 'unknown' : 'unknown'
}
