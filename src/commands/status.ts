import { Command } from '../interfaces/Command.js'
import { config } from '../config.js'
import { checkDatabaseConnection } from '../functions/database.js'
import { checkDocumentsHealth, type DocumentsHealth } from '../services/documentService.js'
import { botLog } from '../services/logService.js'
import { getRuntimeStatus, setDatabaseStatus } from '../services/runtimeStatusService.js'
import { BotResultCode } from '../types/resultCode.js'

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date)
}

interface StatusMessageInput {
  runtime: ReturnType<typeof getRuntimeStatus>
  databaseOk: boolean
  documentsHealth: DocumentsHealth | null
  environment: string
  debug: boolean
  botName: string
}

export function formatStatusMessage({
  runtime,
  databaseOk,
  documentsHealth,
  environment,
  debug,
  botName
}: StatusMessageInput) {
  const documentsAvailable = documentsHealth?.ok === true
  const totalActive = documentsAvailable ? String(documentsHealth.totalActive) : 'indisponível'
  const found = documentsAvailable ? String(documentsHealth.found) : 'indisponível'
  const missing = documentsAvailable ? String(documentsHealth.missing) : 'indisponível'
  const documentsStatus = !documentsAvailable
    ? 'indisponível'
    : documentsHealth.missing === 0
      ? 'ok'
      : 'atenção'
  const missingList = debug && documentsAvailable && documentsHealth.missingDocuments.length
    ? `\nAusentes: ${documentsHealth.missingDocuments.map(document => document.label).join(', ')}`
    : ''
  const databaseStatus = databaseOk ? 'connected' : 'unavailable — código de referência: 503'

  return (
    `📊 *STATUS DO ${botName.toUpperCase()}*\n\n` +
    `WhatsApp: ${runtime.whatsapp}\n` +
    `Banco: ${databaseStatus}\n` +
    `Iniciado em: ${formatDate(runtime.startedAt)}\n` +
    `Ambiente: ${environment}\n` +
    `Documentos ativos no banco: ${totalActive}\n` +
    `Documentos encontrados no disco: ${found}\n` +
    `Documentos ausentes no disco: ${missing}\n` +
    `Status dos documentos: ${documentsStatus}${missingList}\n` +
    `Debug: ${debug ? 'ativo' : 'inativo'}`
  )
}

const statusCommand: Command = {
  name: 'status',
  description: 'Mostra o status do WhatsApp, banco e documentos ativos',
  adminOnly: true,
  execute: async (sock, msg) => {
    const runtime = getRuntimeStatus()
    const database = await checkDatabaseConnection()
    setDatabaseStatus(database.ok ? 'connected' : 'unavailable')

    let documentsHealth: DocumentsHealth | null = null

    if (database.ok) {
      documentsHealth = await checkDocumentsHealth()
    } else {
      botLog('DATABASE_UNAVAILABLE', 'Comando !status detectou banco indisponível', {
        resultCode: BotResultCode.SERVICE_UNAVAILABLE
      })
    }

    const text = formatStatusMessage({
      runtime,
      databaseOk: database.ok,
      documentsHealth,
      environment: config.environment,
      debug: config.debug,
      botName: config.botName
    })

    await sock.sendMessage(msg.key!.remoteJid!, { text })
  }
}

export default statusCommand
