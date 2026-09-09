import { saveLog } from '../functions/database.js'
import { config } from '../config.js'
import { BotResultCode, BotResultCodeValue } from '../types/resultCode.js'
import { AsyncLocalStorage } from 'node:async_hooks'

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
  | 'MESSAGE_IGNORED_DUPLICATE'
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
  resultCode?: BotResultCodeValue
  correlationId?: string
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
  resultCode?: BotResultCodeValue
  correlationId?: string
}

const sensitiveKeys = new Set(['password', 'token', 'qr', 'secret', 'authorization'])
const userContentKeys = new Set(['body', 'text', 'message', 'content', 'messagepreview', 'username'])
const logContext = new AsyncLocalStorage<{ correlationId?: string }>()

const eventResultCodes: Partial<Record<BotEventType, BotResultCodeValue>> = {
  MESSAGE_IGNORED_OLD: BotResultCode.NO_CONTENT,
  MESSAGE_IGNORED_SELF: BotResultCode.NO_CONTENT,
  MESSAGE_IGNORED_GROUP: BotResultCode.NO_CONTENT,
  MESSAGE_IGNORED_DUPLICATE: BotResultCode.CONFLICT,
  SUPPORT_REQUEST: BotResultCode.ACCEPTED,
  COMMAND_DENIED: BotResultCode.FORBIDDEN,
  COMMAND_UNKNOWN: BotResultCode.NOT_FOUND,
  DOCUMENT_REQUESTED: BotResultCode.ACCEPTED,
  DOCUMENT_ERROR: BotResultCode.INTERNAL_ERROR,
  INVALID_OPTION: BotResultCode.BAD_REQUEST,
  RATE_LIMITED: BotResultCode.TOO_MANY_REQUESTS,
  DATABASE_ERROR: BotResultCode.SERVICE_UNAVAILABLE,
  DATABASE_UNAVAILABLE: BotResultCode.SERVICE_UNAVAILABLE,
  WHATSAPP_SEND_ERROR: BotResultCode.SERVICE_UNAVAILABLE,
  UNKNOWN_ERROR: BotResultCode.INTERNAL_ERROR
}

export function resolveEventResultCode(eventType: BotEventType, explicitCode?: BotResultCodeValue) {
  return explicitCode ?? eventResultCodes[eventType] ?? BotResultCode.OK
}

export function runWithLogContext<T>(correlationId: string | undefined, callback: () => Promise<T>) {
  return logContext.run({ correlationId }, callback)
}

function currentCorrelationId(explicit?: string) {
  return explicit || logContext.getStore()?.correlationId
}

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

function isSensitiveKey(key: string) {
  const normalizedKey = key.toLowerCase()
  return [...sensitiveKeys].some((sensitiveKey) => normalizedKey.includes(sensitiveKey))
}

/**
 * Sanitiza todo o contexto, inclusive objetos aninhados. Integrações e erros
 * podem carregar credenciais em propriedades internas, portanto uma limpeza
 * apenas no primeiro nível deixaria dados sensíveis escaparem para o stdout.
 */
function sanitizeValue(key: string, value: unknown, seen: WeakSet<object>): unknown {
  const normalizedKey = key.toLowerCase()

  if (isSensitiveKey(normalizedKey)) return '[REDACTED]'
  if (userContentKeys.has(normalizedKey) && typeof value === 'string') {
    return `[USER_CONTENT_REDACTED:${value.length}]`
  }
  if (normalizedKey === 'user' && typeof value === 'string') return maskPhone(value)
  if (normalizedKey === 'error' || value instanceof Error) return normalizeError(value)
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `[BINARY:${value.length}]`

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    return value.map((item) => sanitizeValue('', item, seen))
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childKey, childValue, seen)
      ])
    )
  }

  return value
}

function sanitizeContext(context?: TechnicalLogContext) {
  if (!context) return undefined
  const seen = new WeakSet<object>()

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, sanitizeValue(key, value, seen)])
  )
}

/**
 * Logs de console ficam concentrados aqui para manter mensagens consistentes.
 * O banco pode falhar, então erros de log persistido nunca devem derrubar o bot.
 */
export function debugLog(message: string, context?: TechnicalLogContext) {
  if (!config.debug && config.logLevel !== 'debug') return
  const sanitizedContext = sanitizeContext(context)
  console.log(JSON.stringify({
    service: 'firabot',
    environment: config.environment,
    at: new Date().toISOString(),
    level: 'debug',
    eventType: context?.eventType || 'UNKNOWN_ERROR',
    code: resolveEventResultCode((context?.eventType as BotEventType) || 'UNKNOWN_ERROR', context?.resultCode),
    correlationId: currentCorrelationId(context?.correlationId),
    message,
    context: sanitizedContext
  }))
}

export function botLog(eventType: BotEventType, message: string, context?: TechnicalLogContext) {
  console.log(JSON.stringify({
    service: 'firabot',
    environment: config.environment,
    at: new Date().toISOString(),
    level: 'info',
    eventType,
    code: resolveEventResultCode(eventType, context?.resultCode),
    correlationId: currentCorrelationId(context?.correlationId),
    message,
    context: sanitizeContext(context)
  }))
}

export function errorLog(eventType: BotEventType, message: string, error: unknown, context?: TechnicalLogContext) {
  console.error(JSON.stringify({
    service: 'firabot',
    environment: config.environment,
    at: new Date().toISOString(),
    level: 'error',
    eventType,
    code: resolveEventResultCode(eventType, context?.resultCode),
    correlationId: currentCorrelationId(context?.correlationId),
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
      resultCode: resolveEventResultCode(eventType, details.resultCode),
      correlationId: currentCorrelationId(details.correlationId),
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
