import { saveLog } from '../functions/database.js'
import { config } from '../config.js'

export type BotEventType =
  | 'BOT_STARTED'
  | 'BOT_CONNECTED'
  | 'BOT_DISCONNECTED'
  | 'BOT_RECONNECTING'
  | 'BOT_LOGGED_OUT'
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_IGNORED_OLD'
  | 'MESSAGE_IGNORED_SELF'
  | 'MESSAGE_IGNORED_GROUP'
  | 'SUPPORT_REQUEST'
  | 'COMMAND_EXECUTED'
  | 'COMMAND_DENIED'
  | 'COMMAND_UNKNOWN'
  | 'MENU_OPENED'
  | 'MENU_OPTION_SELECTED'
  | 'DOCUMENT_REQUESTED'
  | 'DOCUMENT_SENT'
  | 'DOCUMENT_ERROR'
  | 'DOCUMENT_HEALTH'
  | 'USER_STATE_READ'
  | 'USER_STATE_CHANGED'
  | 'INVALID_OPTION'
  | 'RATE_LIMITED'
  | 'DATABASE_ERROR'
  | 'DATABASE_CONNECTED'
  | 'DATABASE_UNAVAILABLE'
  | 'WHATSAPP_SEND_ERROR'
  | 'UNKNOWN_ERROR'

export interface TechnicalLogContext {
  user?: string
  stateBefore?: string
  stateAfter?: string
  command?: string
  menu?: string
  documentId?: string | number
  success?: boolean
  error?: unknown
  [key: string]: unknown
}

export interface UserLogDetails {
  eventType?: BotEventType
  stateBefore?: string
  stateAfter?: string
  command?: string
  menu?: string
  documentId?: string | number
  success?: boolean
  errorMessage?: string
}

const sensitiveKeys = new Set(['password', 'token', 'qr', 'secret', 'authorization'])
const userContentKeys = new Set(['body', 'text', 'message', 'content'])

export function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return `${digits.slice(0, 4)}****${digits.slice(-2)}`
}

function preview(text: string, limit = 140) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function sanitizeContext(context?: TechnicalLogContext) {
  if (!context) return undefined

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      const normalizedKey = key.toLowerCase()
      if (sensitiveKeys.has(normalizedKey)) return [key, '[REDACTED]']
      if (userContentKeys.has(normalizedKey) && typeof value === 'string') {
        return [key, `[USER_CONTENT_REDACTED:${value.length}]`]
      }
      if (key === 'user' && typeof value === 'string') return [key, maskPhone(value)]
      if (key === 'error') return [key, normalizeError(value)]
      return [key, value]
    })
  )
}

/**
 * Logs de console ficam concentrados aqui para manter mensagens consistentes.
 * O banco pode falhar, então erros de log persistido nunca devem derrubar o bot.
 */
export function debugLog(message: string, context?: TechnicalLogContext) {
  if (!config.debug && config.logLevel !== 'debug') return
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    level: 'debug',
    eventType: context?.eventType || 'UNKNOWN_ERROR',
    message,
    context: sanitizeContext(context)
  }))
}

export function botLog(eventType: BotEventType, message: string, context?: TechnicalLogContext) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    level: 'info',
    eventType,
    message,
    context: sanitizeContext(context)
  }))
}

export function errorLog(eventType: BotEventType, message: string, error: unknown, context?: TechnicalLogContext) {
  console.error(JSON.stringify({
    at: new Date().toISOString(),
    level: 'error',
    eventType,
    message,
    context: sanitizeContext({ ...context, error })
  }))
}

/**
 * Registra eventos relevantes do atendimento no MySQL.
 * Usa preview da mensagem e campos estruturados para auditoria, sem guardar
 * tokens, QR Code, senha ou outros dados sensíveis.
 */
export async function registerUserLog(phoneNumber: string, userName: string, message: string, state?: string, eventType: BotEventType = 'MESSAGE_RECEIVED', details: UserLogDetails = {}) {
  try {
    await saveLog(phoneNumber, userName, preview(message), state, eventType, {
      ...details,
      eventType
    })
  } catch (error) {
    errorLog('DATABASE_ERROR', 'Erro ao registrar log no banco', error, {
      user: phoneNumber,
      userName,
      messagePreview: preview(message),
      state,
      eventType
    })
  }
}
