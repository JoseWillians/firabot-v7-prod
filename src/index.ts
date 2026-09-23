import { startBot, stopBot } from './connection.js'
import { validateConfig } from './config.js'
import { botLog, errorLog } from './services/logService.js'
import { checkDatabaseConnection, closeDatabasePool } from './functions/database.js'
import { setDatabaseStatus, setRuntimeStartedAt } from './services/runtimeStatusService.js'
import { technicalErrorLog } from './services/technicalLogger.js'
import { stopPendingFollowUps } from './flows/conversationFlow.js'
import { createGracefulShutdown } from './services/connectionLifecycleService.js'
import { BotResultCode } from './types/resultCode.js'

const shutdown = createGracefulShutdown({
  stopBot,
  stopFollowUps: stopPendingFollowUps,
  closeDatabase: closeDatabasePool,
  onError: error => {
    try {
      errorLog('UNKNOWN_ERROR', 'Falha durante o encerramento gracioso', error)
    } catch (loggingError) {
      technicalErrorLog('UNKNOWN_ERROR', 'Falha ao registrar erro de encerramento', loggingError, BotResultCode.INTERNAL_ERROR)
    }
  },
  onTimeout: () => {
    try {
      errorLog(
        'UNKNOWN_ERROR',
        'Prazo de encerramento gracioso excedido; finalizando processo.',
        new Error('graceful shutdown timeout')
      )
    } finally {
      process.exit(1)
    }
  },
  timeoutMs: 15_000
})

async function bootstrap() {
  validateConfig()
  setRuntimeStartedAt()
  botLog('BOT_STARTED', 'Iniciando o Firabot v7.')

  const databaseStatus = await checkDatabaseConnection()
  if (databaseStatus.ok) {
    setDatabaseStatus('connected')
    botLog('DATABASE_CONNECTED', 'Conexão com MySQL validada na inicialização.')
  } else {
    setDatabaseStatus('unavailable')
    errorLog('DATABASE_UNAVAILABLE', databaseStatus.message, new Error(databaseStatus.message))
  }

  await startBot()
}

function handleShutdown(signal: NodeJS.Signals) {
  botLog('BOT_DISCONNECTED', `Encerramento solicitado por ${signal}.`)
  void shutdown().then(() => {
    process.exitCode = 0
  })
}

process.once('SIGINT', () => handleShutdown('SIGINT'))
process.once('SIGTERM', () => handleShutdown('SIGTERM'))

bootstrap().catch(error => {
  try {
    errorLog('UNKNOWN_ERROR', 'Erro na inicialização', error)
  } catch (loggingError) {
    technicalErrorLog('UNKNOWN_ERROR', 'Falha ao registrar erro de inicialização', loggingError, BotResultCode.INTERNAL_ERROR)
  }
  void shutdown().finally(() => {
    process.exitCode = 1
  })
})
