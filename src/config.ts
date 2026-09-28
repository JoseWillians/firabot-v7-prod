import dotenv from 'dotenv'

/**
 * Centraliza leitura de ambiente em um único módulo.
 * Isso evita espalhar process.env pelo projeto e facilita trocar nomes
 * de variáveis sem mexer nas regras de negócio do bot.
 */
// Testes podem apontar para um arquivo isolado, sem carregar o .env operacional.
dotenv.config({ quiet: true, path: process.env.DOTENV_CONFIG_PATH || '.env' })

const toInteger = (value: string | undefined, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  const normalized = value?.trim()
  if (!normalized) return fallback

  if (!/^\d+$/.test(normalized)) return fallback
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

const environmentDatabaseName = process.env.DB_NAME?.trim()
const mysqlDatabaseName = process.env.MYSQL_DATABASE?.trim()
const maxNodeTimerDelayMs = 2_147_483_647

const numericEnvironment = [
  ['MESSAGE_START_GRACE_SECONDS', 0, Number.MAX_SAFE_INTEGER],
  ['SPAM_WINDOW_MS', 0, Number.MAX_SAFE_INTEGER],
  ['MESSAGE_DEDUP_TTL_MS', 0, Number.MAX_SAFE_INTEGER],
  ['RECONNECT_DELAY_MS', 1, maxNodeTimerDelayMs],
  ['USER_STATE_TTL_MINUTES', 0, Number.MAX_SAFE_INTEGER],
  ['DOCUMENT_MAX_SIZE_MB', 1, Number.MAX_SAFE_INTEGER],
  ['SUPPORT_TICKET_RETENTION_DAYS', 0, Number.MAX_SAFE_INTEGER],
  ['DB_PORT', 1, 65535]
] as const

const toBoolean = (value: string | undefined) => {
  return ['1', 'true', 'yes', 'sim'].includes((value || '').toLowerCase())
}

const toList = (value: string | undefined) => {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const config = {
  environment: process.env.NODE_ENV || 'development',
  botName: process.env.BOT_NAME || 'Firabot v7',
  campus: process.env.BOT_CAMPUS || process.env.CAMPUS_NAME || 'IFMA Santa Inês',
  documentsBasePath: process.env.DOCUMENTS_DIR || process.env.DOCUMENTS_BASE_PATH || './documentos',
  debug: toBoolean(process.env.DEBUG_MODE),
  logLevel: process.env.LOG_LEVEL || 'info',
  ignoreOldMessages: process.env.IGNORE_OLD_MESSAGES ? toBoolean(process.env.IGNORE_OLD_MESSAGES) : true,
  ignoreGroups: process.env.IGNORE_GROUPS ? toBoolean(process.env.IGNORE_GROUPS) : true,
  messageStartGraceSeconds: toInteger(process.env.MESSAGE_START_GRACE_SECONDS, 0),
  spamWindowMs: toInteger(process.env.SPAM_WINDOW_MS, 2500),
  messageDedupTtlMs: toInteger(process.env.MESSAGE_DEDUP_TTL_MS, 10 * 60 * 1000),
  reconnectDelayMs: toInteger(process.env.RECONNECT_DELAY_MS, 5000, 1, maxNodeTimerDelayMs),
  userStateTtlMinutes: toInteger(process.env.USER_STATE_TTL_MINUTES, 60),
  documentMaxSizeMb: toInteger(process.env.DOCUMENT_MAX_SIZE_MB, 25, 1),
  supportTicketRetentionDays: toInteger(process.env.SUPPORT_TICKET_RETENTION_DAYS, 0),
  adminNumbers: toList(process.env.ADMIN_NUMBERS),
  database: {
    host: process.env.DB_HOST,
    port: toInteger(process.env.DB_PORT, 3306, 1, 65535),
    user: process.env.DB_USER || 'firabot_app',
    password: process.env.FIRABOT_APP_DB_PASSWORD || process.env.DB_PASSWORD || process.env.DB_PASS,
    name: environmentDatabaseName || mysqlDatabaseName || 'firabot'
  }
}

/**
 * Valida variáveis críticas antes de iniciar o bot. O segredo do banco nunca
 * aparece nas mensagens de erro ou nos logs.
 */
export function validateConfig() {
  const invalidNumbers = numericEnvironment
    .filter(([name, minimum, maximum]) => {
      const value = process.env[name]?.trim()
      if (!value) return false
      if (!/^\d+$/.test(value)) return true
      const parsed = Number(value)
      return !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum
    })
    .map(([name]) => name)

  if (invalidNumbers.length) {
    throw new Error(`Configuração numérica inválida. Revise: ${invalidNumbers.join(', ')}`)
  }

  if (environmentDatabaseName && mysqlDatabaseName && environmentDatabaseName !== mysqlDatabaseName) {
    throw new Error('DB_NAME deve ser igual a MYSQL_DATABASE quando ambos forem definidos.')
  }

  if (!/^[A-Za-z0-9_]{1,64}$/.test(config.database.name)) {
    throw new Error('DB_NAME/MYSQL_DATABASE deve conter de 1 a 64 letras, números ou underscores.')
  }

  const missing = [
    ['DB_HOST', config.database.host],
    ['DB_USER', config.database.user],
    ['FIRABOT_APP_DB_PASSWORD', config.database.password],
    ['DB_NAME', config.database.name]
  ].filter(([, value]) => !value)

  if (missing.length) {
    throw new Error(`Configuração incompleta. Defina: ${missing.map(([name]) => name).join(', ')}`)
  }
}
