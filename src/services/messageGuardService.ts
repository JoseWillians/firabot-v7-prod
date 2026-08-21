import { proto } from 'baileys'
import { config } from '../config.js'

/**
 * Normaliza texto livre antes das comparações de intenção.
 * O WhatsApp chega com variações de acento, caixa e pontuação; comparar tudo
 * normalizado deixa "olá", "Ola!" e "ola" equivalentes para o início do fluxo.
 */
export const normalizeText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[!?.,;:]+$/g, '')
    .replace(/\s+/g, ' ')

export function getMessageTimestamp(msg: proto.IWebMessageInfo): number {
  const timestamp = msg.messageTimestamp

  if (typeof timestamp === 'number') return timestamp
  if (typeof timestamp === 'string') return Number(timestamp)
  if (timestamp && typeof timestamp === 'object' && 'toNumber' in timestamp) {
    return timestamp.toNumber()
  }

  return 0
}

export function isMessageFromBeforeStart(messageTimestamp: number, startedAt: number): boolean {
  if (!config.ignoreOldMessages) return false
  return !messageTimestamp || messageTimestamp < startedAt - config.messageStartGraceSeconds
}

/**
 * Define quais mensagens sem "!" podem iniciar atendimento.
 * Isso remove a obrigação do prefixo para usuários comuns, mas evita responder
 * qualquer texto aleatório e causar spam em conversas antigas.
 */
export function isGreetingOrStartMessage(text: string): boolean {
  const normalized = normalizeText(text)

  const exactStarts = new Set([
    'oi',
    'ola',
    'bom dia',
    'boa tarde',
    'boa noite',
    'menu',
    'iniciar',
    'inicio',
    'começar',
    'comecar',
    'ajuda',
    'help',
    'start'
  ])

  if (exactStarts.has(normalized)) return true

  return /^(oi|ola|bom dia|boa tarde|boa noite)\b/.test(normalized)
}

export function isPrefixedCommand(text: string, prefix = '!') {
  return text.trim().startsWith(prefix)
}
