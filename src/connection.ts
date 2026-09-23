import makeWASocket, { DisconnectReason, fetchLatestWaWebVersion, useMultiFileAuthState, type WASocket } from 'baileys'
import qrcode from 'qrcode-terminal'
import { messageHandler } from './middlewares/messageHandler.js'
import { config } from './config.js'
import { botLog, errorLog } from './services/logService.js'
import { createConnectionLifecycle } from './services/connectionLifecycleService.js'
import { setWhatsAppStatus } from './services/runtimeStatusService.js'

const lifecycle = createConnectionLifecycle(
  {
    reconnectDelayMs: config.reconnectDelayMs,
    loggedOutReason: DisconnectReason.loggedOut
  },
  {
    prepare: async () => {
      const { state, saveCreds } = await useMultiFileAuthState('auth')
      const { version } = await fetchLatestWaWebVersion()

      return {
        createSocket: () => makeWASocket({
          auth: state,
          version,
          printQRInTerminal: false,
          // Evita sincronizar historico completo; startedAt protege contra backlog.
          syncFullHistory: false,
          browser: ['Firabot', 'Chrome', '1.0.0']
        }) as WASocket,
        saveCreds
      }
    },
    handleMessage: async (socket, event, context) => {
      await messageHandler(socket, event, context)
    },
    setStatus: status => {
      // Importado aqui para manter o lifecycle independente do runtime global.
      setWhatsAppStatus(status)
    },
    onEvent: (event, context) => {
      switch (event) {
        case 'BOT_STARTED':
          botLog(event, 'Estabelecendo ponte com o WhatsApp.')
          break
        case 'BOT_CONNECTED':
          botLog(event, `${config.botName} está online e pronto.`)
          break
        case 'BOT_RECONNECTING':
          botLog(event, 'WhatsApp desconectado. Reagendando reconexão.', context)
          break
        case 'BOT_LOGGED_OUT':
          botLog(event, 'Sessão encerrada no WhatsApp. Leia um novo QR Code para reconectar.', context)
          break
      }
    },
    onError: (message, error) => errorLog('UNKNOWN_ERROR', message, error),
    showQr: qr => {
      botLog('BOT_STARTED', 'Novo QR Code gerado. Aguardando leitura.')
      qrcode.generate(qr, { small: true })
    }
  }
)

/** Inicializa a conexão. Falhas transitórias são registradas pelo lifecycle e reagendadas. */
export const startBot = () => lifecycle.start()

/** Interrompe novas entradas, drena mensagens/credenciais e encerra o socket. */
export const stopBot = () => lifecycle.stop()
