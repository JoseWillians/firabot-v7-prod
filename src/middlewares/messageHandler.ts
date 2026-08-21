import { WASocket, proto } from 'baileys'
import { processCommand } from '../handlers/commandHandler.js'
import { processMenuOption } from '../handlers/menuOptionHandler.js'
import { config } from '../config.js'
import { sendEndFlow, sendMainMenu, sendStartFlow, sendUnknownMessage } from '../flows/conversationFlow.js'
import { handleSupportMessage } from '../flows/supportFlow.js'
import { getCurrentUserState } from '../services/userStateService.js'
import { botLog, debugLog, registerUserLog } from '../services/logService.js'
import { canRespondToUser } from '../services/spamGuardService.js'
import { extractMessageText } from '../services/messageTextService.js'
import { isNumericOption } from '../services/menuService.js'
import { shouldCaptureSupportMessage } from '../services/menuRoutingService.js'
import {
  getMessageTimestamp,
  isGreetingOrStartMessage,
  isMessageFromBeforeStart,
  isPrefixedCommand
} from '../services/messageGuardService.js'

interface MessageHandlerOptions {
  startedAt: number
}

export { sendMainMenu }

export const messageHandler = async (sock: WASocket, m: { messages: proto.IWebMessageInfo[] }, options: MessageHandlerOptions) => {
  const msg = m.messages[0]
  const remoteJid = msg.key?.remoteJid
  if (!remoteJid) return

  if (!msg.message || remoteJid === 'status@broadcast') return

  if (msg.key?.fromMe) {
    debugLog('Mensagem ignorada por ter sido enviada pelo próprio bot', { eventType: 'MESSAGE_IGNORED_SELF' })
    return
  }

  if (config.ignoreGroups && remoteJid?.endsWith('@g.us')) {
    debugLog('Mensagem de grupo ignorada pela configuração atual', { eventType: 'MESSAGE_IGNORED_GROUP', user: remoteJid })
    return
  }

  const timestamp = getMessageTimestamp(msg)
  if (isMessageFromBeforeStart(timestamp, options.startedAt)) {
    debugLog('Mensagem antiga ignorada', { eventType: 'MESSAGE_IGNORED_OLD', user: remoteJid, timestamp, startedAt: options.startedAt })
    return
  }

  const userJid = remoteJid
  const userName = msg.pushName || 'Aluno(a)'
  const body = extractMessageText(msg.message)

  if (!body) return

  const currentState = await getCurrentUserState(userJid)
  botLog('MESSAGE_RECEIVED', 'Mensagem recebida', {
    user: userJid,
    messageLength: body.length,
    isCommand: isPrefixedCommand(body),
    stateBefore: currentState
  })

  if (isPrefixedCommand(body)) {
    await processCommand(sock, msg, body, userJid, userName, currentState)
    return
  }

  if (body.trim().toLowerCase() === 'encerrar') {
    await sendEndFlow(sock, userJid, userName, currentState)
    return
  }

  if (!canRespondToUser(`${userJid}:${body.toLowerCase()}`)) {
    debugLog('Resposta ignorada por proteção anti-spam', { eventType: 'RATE_LIMITED', user: userJid, messageLength: body.length })
    return
  }

  if (isGreetingOrStartMessage(body)) {
    await sendStartFlow(sock, userJid, userName, `Início: ${body}`)
    return
  }

  if (shouldCaptureSupportMessage(currentState, body)) {
    await handleSupportMessage(sock, userJid, userName, body, currentState)
    return
  }

  if (isNumericOption(body)) {
    await processMenuOption(sock, userJid, userName, body, currentState)
    return
  }

  await sendUnknownMessage(sock, userJid, currentState)
  await registerUserLog(userJid, userName, `Mensagem não compreendida (${body.length} caracteres)`, currentState, 'INVALID_OPTION', { stateBefore: currentState, success: false })
}
