import makeWASocket, { DisconnectReason, WASocket, useMultiFileAuthState, fetchLatestWaWebVersion } from 'baileys'
import qrcode from 'qrcode-terminal'
import { messageHandler } from './middlewares/messageHandler.js'
import { config } from './config.js'
import { botLog, errorLog } from './services/logService.js'
import { setWhatsAppStatus } from './services/runtimeStatusService.js'

let activeSocket: WASocket | null = null
let isStarting = false
let reconnectTimer: NodeJS.Timeout | null = null

/**
 * Agenda reconexão fora do callback de fechamento.
 * O timer único evita várias tentativas simultâneas quando o Baileys emite
 * eventos próximos entre si ou quando startBot é chamado manualmente.
 */
const scheduleReconnect = () => {
  if (reconnectTimer) return

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    startBot().catch(err => {
      errorLog('BOT_RECONNECTING', 'Erro ao tentar reconectar', err)
      scheduleReconnect()
    })
  }, config.reconnectDelayMs)
}

const getDisconnectStatusCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'output' in error) {
    const output = (error as { output?: { statusCode?: number } }).output
    return output?.statusCode
  }

  return undefined
}

export const startBot = async () => {
  /**
   * Protege contra múltiplas instâncias no mesmo processo.
   * Sem essa trava, uma reconexão pode registrar listeners duplicados e o bot
   * passa a responder a mesma mensagem mais de uma vez.
   */
  if (isStarting || activeSocket) {
    botLog('BOT_STARTED', 'Instância do Firabot já está ativa ou iniciando.')
    return
  }

  isStarting = true
  setWhatsAppStatus('starting')
  const startedAt = Math.floor(Date.now() / 1000)

  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth")
    const { version } = await fetchLatestWaWebVersion()

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      // Evita sincronizar histórico completo; o filtro por startedAt no handler
      // faz a segunda camada de proteção contra backlog de conversas antigas.
      syncFullHistory: false,
      browser: ["Firabot", "Chrome", "1.0.0"]
    })

    activeSocket = sock
    isStarting = false

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update
  
      if (qr) {
        botLog('BOT_STARTED', 'Novo QR Code gerado. Aguardando leitura.')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'connecting') {
        setWhatsAppStatus('connecting')
        botLog('BOT_STARTED', 'Estabelecendo ponte com o WhatsApp.')
      }

      if (connection === 'open') {
        setWhatsAppStatus('connected')
        botLog('BOT_CONNECTED', `${config.botName} está online e pronto.`)
      }

      if (connection === 'close') {
        const reason = getDisconnectStatusCode(lastDisconnect?.error)
        activeSocket = null
        setWhatsAppStatus('disconnected')

        if (reason === DisconnectReason.loggedOut) {
          setWhatsAppStatus('logged_out')
          botLog('BOT_LOGGED_OUT', 'Sessão encerrada no WhatsApp. Leia um novo QR Code para reconectar.', { reason })
          return
        }

        botLog('BOT_RECONNECTING', 'WhatsApp desconectado. Reagendando reconexão.', {
          reason,
          reconnectDelayMs: config.reconnectDelayMs
        })
        scheduleReconnect()
      }
    })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('messages.upsert', async (m) => {
      try {
        await messageHandler(sock, m, { startedAt })
      } catch (error) {
        errorLog('UNKNOWN_ERROR', 'Erro ao processar mensagem recebida', error)
      }
    })
  } catch (error) {
    isStarting = false
    activeSocket = null
    setWhatsAppStatus('disconnected')
    errorLog('UNKNOWN_ERROR', 'Erro ao iniciar conexão com o WhatsApp', error)
    throw error
  }
}
