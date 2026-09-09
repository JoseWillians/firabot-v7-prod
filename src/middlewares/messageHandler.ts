import { WASocket, proto } from 'baileys'
import { processCommand } from '../handlers/commandHandler.js'
import { processMenuOption } from '../handlers/menuOptionHandler.js'
import { config } from '../config.js'
import { cancelPendingFollowUp, sendEndFlow, sendMainMenu, sendStartFlow, sendUnknownMessage } from '../flows/conversationFlow.js'
import { processMainOption } from '../flows/mainMenuFlow.js'
import { handleSupportMessage } from '../flows/supportFlow.js'
import { canSafelyRouteNumericInput, getCurrentUserStateResult, updateUserState } from '../services/userStateService.js'
import { botLog, debugLog, errorLog, registerUserLog, runWithLogContext } from '../services/logService.js'
import { canRespondToUser } from '../services/spamGuardService.js'
import { extractMessageText } from '../services/messageTextService.js'
import { isNumericOption } from '../services/menuService.js'
import { shouldCaptureSupportMessage } from '../services/menuRoutingService.js'
import { processMessageBatch, shouldProcessMessageId } from '../services/messageBatchService.js'
import { detectConversationIntent } from '../services/conversationIntentService.js'
import { getMessageJidCandidates } from '../services/userIdentityService.js'
import { upsertUserIdentity } from '../functions/database.js'
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
  await processMessageBatch(
    m.messages,
    async msg => {
      await runWithLogContext(msg.key?.id || undefined, async () => {
        await handleMessage(sock, msg, options)
      })
    },
    async (error, msg) => {
      await runWithLogContext(msg.key?.id || undefined, async () => {
        errorLog('UNKNOWN_ERROR', 'Erro isolado ao processar item do lote de mensagens', error, {
          user: msg.key?.remoteJid || undefined,
          resultCode: 500
        })
      })
    }
  )
}

async function handleMessage(sock: WASocket, msg: proto.IWebMessageInfo, options: MessageHandlerOptions) {
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

  if (!shouldProcessMessageId(msg.key?.id || undefined, Date.now(), config.messageDedupTtlMs)) {
    debugLog('Mensagem duplicada ignorada', {
      eventType: 'MESSAGE_IGNORED_DUPLICATE',
      user: remoteJid,
      correlationId: msg.key?.id || undefined,
      resultCode: 409
    })
    return
  }

  const userJid = remoteJid
  const userName = msg.pushName || 'Aluno(a)'
  const body = extractMessageText(msg.message)

  if (!body) return
  cancelPendingFollowUp(userJid)

  try {
    await upsertUserIdentity(userJid, userName, getMessageJidCandidates(msg))
  } catch (error) {
    errorLog('DATABASE_ERROR', 'Não foi possível enriquecer a identidade do usuário', error, {
      user: userJid,
      resultCode: 503
    })
  }

  const stateLookup = await getCurrentUserStateResult(userJid)
  const currentState = stateLookup.state
  botLog('MESSAGE_RECEIVED', 'Mensagem recebida', {
    user: userJid,
    messageLength: body.length,
    isCommand: isPrefixedCommand(body),
    stateBefore: currentState,
    correlationId: msg.key?.id || undefined
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

  const intent = detectConversationIntent(body)
  if (intent === 'end') {
    await sendEndFlow(sock, userJid, userName, currentState)
    return
  }

  if (intent === 'main') {
    await sendMainMenu(sock, userJid)
    const stateAfter = await updateUserState(userJid, 'main')
    await registerUserLog(userJid, userName, 'Retorno ao menu principal por intenção', currentState, 'USER_STATE_CHANGED', {
      stateBefore: currentState,
      stateAfter,
      menu: 'menu principal',
      success: true
    })
    return
  }

  const mainOptionByIntent = { documents: '2', course: '3', support: '7' } as const
  if (intent && intent in mainOptionByIntent) {
    await processMainOption(sock, userJid, userName, mainOptionByIntent[intent as keyof typeof mainOptionByIntent], currentState)
    return
  }

  if (isNumericOption(body) && !canSafelyRouteNumericInput(stateLookup)) {
    await sock.sendMessage(userJid, {
      text: 'Não consegui recuperar o andamento do seu atendimento agora. Tente novamente em alguns instantes ou envie menu para reiniciar. Código de referência: 503.'
    })
    botLog('DATABASE_UNAVAILABLE', 'Opção numérica bloqueada sem estado confiável', {
      user: userJid,
      stateBefore: currentState,
      stateSource: stateLookup.source,
      resultCode: 503,
      correlationId: msg.key?.id || undefined
    })
    await registerUserLog(userJid, userName, 'Opção numérica bloqueada por indisponibilidade do estado', currentState, 'DATABASE_UNAVAILABLE', {
      stateBefore: currentState,
      success: false,
      resultCode: 503,
      errorMessage: 'Estado indisponível para roteamento numérico'
    })
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
