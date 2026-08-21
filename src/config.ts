import dotenv from 'dotenv'

/**
 * Centraliza leitura de ambiente em um único módulo.
 * Isso evita espalhar process.env pelo projeto e facilita trocar nomes
 * de variáveis sem mexer nas regras de negócio do bot.
 */
dotenv.config({ quiet: true })

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const toBoolean = (value: string | undefined) => {
  return ['1', 'true', 'yes', 'sim'].includes((value || '').toLowerCase())
}

const toList = (value: string | undefined) => {
  return (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export const config = {
  botName: process.env.BOT_NAME || 'Firabot v7',
  campus: process.env.BOT_CAMPUS || process.env.CAMPUS_NAME || 'IFMA Santa Inês',
  documentsBasePath: process.env.DOCUMENTS_DIR || process.env.DOCUMENTS_BASE_PATH || './documentos',
  debug: toBoolean(process.env.DEBUG_MODE),
  logLevel: process.env.LOG_LEVEL || 'info',
  ignoreOldMessages: process.env.IGNORE_OLD_MESSAGES ? toBoolean(process.env.IGNORE_OLD_MESSAGES) : true,
  ignoreGroups: process.env.IGNORE_GROUPS ? toBoolean(process.env.IGNORE_GROUPS) : true,
  messageStartGraceSeconds: toNumber(process.env.MESSAGE_START_GRACE_SECONDS, 0),
  spamWindowMs: toNumber(process.env.SPAM_WINDOW_MS, 2500),
  reconnectDelayMs: toNumber(process.env.RECONNECT_DELAY_MS, 5000),
  userStateTtlMinutes: toNumber(process.env.USER_STATE_TTL_MINUTES, 60),
  documentMaxSizeMb: toNumber(process.env.DOCUMENT_MAX_SIZE_MB, 25),
  adminNumbers: toList(process.env.ADMIN_NUMBERS),
  database: {
    host: process.env.DB_HOST,
    port: toNumber(process.env.DB_PORT, 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    name: process.env.DB_NAME || 'firabot'
  }
}

/**
 * Valida apenas variáveis críticas para iniciar a aplicação.
 * A senha do banco pode ser vazia em ambientes locais, então ela não entra na
 * lista obrigatória e nunca é exibida em logs.
 */
export function validateConfig() {
  const missing = [
    ['DB_HOST', config.database.host],
    ['DB_USER', config.database.user],
    ['DB_NAME', config.database.name]
  ].filter(([, value]) => !value)

  if (missing.length) {
    throw new Error(`Configuração incompleta. Defina: ${missing.map(([name]) => name).join(', ')}`)
  }
}
