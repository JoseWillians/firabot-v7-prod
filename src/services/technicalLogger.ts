import { config } from '../config.js'
import type { BotResultCodeValue } from '../types/resultCode.js'

function normalizeTechnicalError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) }
  const code = 'code' in error ? String((error as Error & { code?: unknown }).code || '') : undefined
  return {
    name: error.name,
    message: error.message.replace(/(password|senha|token|secret)\s*[=:]\s*\S+/gi, '$1=[REDACTED]'),
    ...(code ? { code } : {})
  }
}

/**
 * Logger técnico independente do MySQL. A camada de banco pode usá-lo sem
 * importar logService/saveLog e, portanto, sem criar dependência circular.
 */
export function technicalErrorLog(eventType: string, message: string, error: unknown, code: BotResultCodeValue, context: Record<string, unknown> = {}) {
  console.error(JSON.stringify({
    service: 'firabot',
    environment: config.environment,
    at: new Date().toISOString(),
    level: 'error',
    eventType,
    code,
    message,
    context: {
      ...context,
      error: normalizeTechnicalError(error)
    }
  }))
}
