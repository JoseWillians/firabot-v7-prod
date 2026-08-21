import { startBot } from './connection.js'
import { validateConfig } from './config.js'
import { botLog, errorLog } from './services/logService.js'
import { checkDatabaseConnection } from './functions/database.js'
import { setDatabaseStatus, setRuntimeStartedAt } from './services/runtimeStatusService.js'

/**
 * Ponto de entrada enxuto: toda configuração de conexão, reconexão e handlers
 * fica em connection.ts. Aqui só inicializamos e registramos falha fatal.
 */
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

  /**
   * Registra encerramento solicitado pelo ambiente.
   * Em Docker/serviços, SIGTERM é o caminho comum de parada; o log ajuda a
   * diferenciar parada planejada de queda inesperada.
   */
  process.once('SIGINT', () => {
    botLog('BOT_DISCONNECTED', 'Encerramento solicitado por SIGINT.')
    process.exit(0)
  })

  process.once('SIGTERM', () => {
    botLog('BOT_DISCONNECTED', 'Encerramento solicitado por SIGTERM.')
    process.exit(0)
  })

  await startBot()
}

bootstrap().catch(error => {
  try {
    errorLog('UNKNOWN_ERROR', 'Erro na inicialização', error)
  } catch {
    console.error('Erro na inicialização:', error)
  }
})
