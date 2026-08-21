import { Command } from '../interfaces/Command.js'
import { config } from '../config.js'
import { checkDatabaseConnection } from '../functions/database.js'
import { checkDocumentsHealth, DocumentsHealth } from '../services/documentService.js'
import { getRuntimeStatus, setDatabaseStatus } from '../services/runtimeStatusService.js'

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date)
}

const statusCommand: Command = {
  name: 'status',
  description: 'Mostra o status do WhatsApp, banco e documentos ativos',
  adminOnly: true,
  execute: async (sock, msg) => {
    const runtime = getRuntimeStatus()
    const database = await checkDatabaseConnection()
    setDatabaseStatus(database.ok ? 'connected' : 'unavailable')

    let documentsHealth: DocumentsHealth = {
      ok: false,
      totalActive: 0,
      found: 0,
      missing: 0,
      missingDocuments: [],
      errorMessage: undefined
    }

    if (database.ok) {
      documentsHealth = await checkDocumentsHealth()
    }

    const documentsStatus = !documentsHealth.ok ? 'indisponível' : documentsHealth.missing === 0 ? 'ok' : 'atenção'
    const missingList = config.debug && documentsHealth.missingDocuments.length
      ? `\nAusentes: ${documentsHealth.missingDocuments.map(document => document.label).join(', ')}`
      : ''

    const text =
      `📊 *STATUS DO ${config.botName.toUpperCase()}*\n\n` +
      `WhatsApp: ${runtime.whatsapp}\n` +
      `Banco: ${database.ok ? 'connected' : 'unavailable'}\n` +
      `Iniciado em: ${formatDate(runtime.startedAt)}\n` +
      `Ambiente: ${process.env.NODE_ENV || 'development'}\n` +
      `Documentos ativos no banco: ${documentsHealth.totalActive}\n` +
      `Documentos encontrados no disco: ${documentsHealth.found}\n` +
      `Documentos ausentes no disco: ${documentsHealth.missing}\n` +
      `Status dos documentos: ${documentsStatus}${missingList}\n` +
      `Debug: ${config.debug ? 'ativo' : 'inativo'}`

    await sock.sendMessage(msg.key!.remoteJid!, { text })
  }
}

export default statusCommand
