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

export interface MessageHandlerOptions {
  startedAt: number
  ignoreGroups?: boolean
  messageDedupTtlMs?: number
}

export interface MessageHandlerDependencies {
  now: () => number
  shouldProcessId: typeof shouldProcessMessageId
  canRespond: typeof canRespondToUser
  upsertIdentity: typeof upsertUserIdentity
  getUserState: typeof getCurrentUserStateResult
  updateState: typeof updateUserState
  handleCommand: typeof processCommand
  handleMenuOption: typeof processMenuOption
  handleMainOption: typeof processMainOption
  handleSupport: typeof handleSupportMessage
  cancelFollowUp: typeof cancelPendingFollowUp
  sendEnd: typeof sendEndFlow
  sendMain: typeof sendMainMenu
  sendStart: typeof sendStartFlow
  sendUnknown: typeof sendUnknownMessage
  writeBotLog: typeof botLog
  writeDebugLog: typeof debugLog
  writeErrorLog: typeof errorLog
  writeUserLog: typeof registerUserLog
  withLogContext: typeof runWithLogContext
}

export { sendMainMenu }

const defaultDependencies: MessageHandlerDependencies = {
  now: () => Date.now(),
  shouldProcessId: shouldProcessMessageId,
  canRespond: canRespondToUser,
  upsertIdentity: upsertUserIdentity,
  getUserState: getCurrentUserStateResult,
  updateState: updateUserState,
  handleCommand: processCommand,
  handleMenuOption: processMenuOption,
  handleMainOption: processMainOption,
  handleSupport: handleSupportMessage,
  cancelFollowUp: cancelPendingFollowUp,
  sendEnd: sendEndFlow,
  sendMain: sendMainMenu,
  sendStart: sendStartFlow,
  sendUnknown: sendUnknownMessage,
  writeBotLog: botLog,
  writeDebugLog: debugLog,
  writeErrorLog: errorLog,
  writeUserLog: registerUserLog,
  withLogContext: runWithLogContext
}

export const messageHandler = async (
  sock: WASocket,
  m: { messages: proto.IWebMessageInfo[] },
  options: MessageHandlerOptions,
  dependencyOverrides: Partial<MessageHandlerDependencies> = {}
) => {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  await processMessageBatch(
    m.messages,
    async msg => {
      await dependencies.withLogContext(msg.key?.id || undefined, async () => {
        await handleMessage(sock, msg, options, dependencies)
      })
    },
    async (error, msg) => {
      await dependencies.withLogContext(msg.key?.id || undefined, async () => {
        dependencies.writeErrorLog('UNKNOWN_ERROR', 'Erro isolado ao processar item do lote de mensagens', error, {
          user: msg.key?.remoteJid || undefined,
          resultCode: 500
        })
      })
    }
  )
}

async function handleMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  options: MessageHandlerOptions,
  dependencies: MessageHandlerDependencies
) {
  const remoteJid = msg.key?.remoteJid
  if (!remoteJid) return

  if (!msg.message || remoteJid === 'status@broadcast') return

  if (msg.key?.fromMe) {
    dependencies.writeDebugLog('Mensagem ignorada por ter sido enviada pelo próprio bot', { eventType: 'MESSAGE_IGNORED_SELF' })
    return
  }

  const ignoreGroups = options.ignoreGroups ?? config.ignoreGroups
  if (ignoreGroups && remoteJid.endsWith('@g.us')) {
    dependencies.writeDebugLog('Mensagem de grupo ignorada pela configuração atual', { eventType: 'MESSAGE_IGNORED_GROUP', user: remoteJid })
    return
  }

  const timestamp = getMessageTimestamp(msg)
  if (isMessageFromBeforeStart(timestamp, options.startedAt)) {
    dependencies.writeDebugLog('Mensagem antiga ignorada', { eventType: 'MESSAGE_IGNORED_OLD', user: remoteJid, timestamp, startedAt: options.startedAt })
    return
  }

  const messageDedupTtlMs = options.messageDedupTtlMs ?? config.messageDedupTtlMs
  if (!dependencies.shouldProcessId(msg.key?.id || undefined, dependencies.now(), messageDedupTtlMs)) {
    dependencies.writeDebugLog('Mensagem duplicada ignorada', {
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
  dependencies.cancelFollowUp(userJid)

  try {
    await dependencies.upsertIdentity(userJid, userName, getMessageJidCandidates(msg))
  } catch (error) {
    dependencies.writeErrorLog('DATABASE_ERROR', 'Não foi possível enriquecer a identidade do usuário', error, {
      user: userJid,
      resultCode: 503
    })
  }

  const stateLookup = await dependencies.getUserState(userJid)
  const currentState = stateLookup.state
  dependencies.writeBotLog('MESSAGE_RECEIVED', 'Mensagem recebida', {
    user: userJid,
    messageLength: body.length,
    isCommand: isPrefixedCommand(body),
    stateBefore: currentState,
    correlationId: msg.key?.id || undefined
  })

  if (isPrefixedCommand(body)) {
    await dependencies.handleCommand(sock, msg, body, userJid, userName, currentState)
    return
  }

  if (body.trim().toLowerCase() === 'encerrar') {
    await dependencies.sendEnd(sock, userJid, userName, currentState)
    return
  }

  if (!dependencies.canRespond(`${userJid}:${body.toLowerCase()}`)) {
    dependencies.writeDebugLog('Resposta ignorada por proteção anti-spam', { eventType: 'RATE_LIMITED', user: userJid, messageLength: body.length })
    return
  }

  if (isGreetingOrStartMessage(body)) {
    await dependencies.sendStart(sock, userJid, userName, `Início: ${body}`)
    return
  }

  const intent = detectConversationIntent(body)
  if (intent === 'end') {
    await dependencies.sendEnd(sock, userJid, userName, currentState)
    return
  }

  if (intent === 'main') {
    await dependencies.sendMain(sock, userJid)
    const stateAfter = await dependencies.updateState(userJid, 'main')
    await dependencies.writeUserLog(userJid, userName, 'Retorno ao menu principal por intenção', currentState, 'USER_STATE_CHANGED', {
      stateBefore: currentState,
      stateAfter,
      menu: 'menu principal',
      success: true
    })
    return
  }

  const mainOptionByIntent = { documents: '2', course: '3', support: '7' } as const
  if (intent && intent in mainOptionByIntent) {
    await dependencies.handleMainOption(sock, userJid, userName, mainOptionByIntent[intent as keyof typeof mainOptionByIntent], currentState)
    return
  }

  if (isNumericOption(body) && !canSafelyRouteNumericInput(stateLookup)) {
    await sock.sendMessage(userJid, {
      text: 'Não consegui recuperar o andamento do seu atendimento agora. Tente novamente em alguns instantes ou envie menu para reiniciar. Código de referência: 503.'
    })
    dependencies.writeBotLog('DATABASE_UNAVAILABLE', 'Opção numérica bloqueada sem estado confiável', {
      user: userJid,
      stateBefore: currentState,
      stateSource: stateLookup.source,
      resultCode: 503,
      correlationId: msg.key?.id || undefined
    })
    await dependencies.writeUserLog(userJid, userName, 'Opção numérica bloqueada por indisponibilidade do estado', currentState, 'DATABASE_UNAVAILABLE', {
      stateBefore: currentState,
      success: false,
      resultCode: 503,
      errorMessage: 'Estado indisponível para roteamento numérico'
    })
    return
  }

  if (shouldCaptureSupportMessage(currentState, body)) {
    await dependencies.handleSupport(sock, userJid, userName, body, currentState)
    return
  }

  if (isNumericOption(body)) {
    await dependencies.handleMenuOption(sock, userJid, userName, body, currentState)
    return
  }

  await dependencies.sendUnknown(sock, userJid, currentState)
  await dependencies.writeUserLog(userJid, userName, `Mensagem não compreendida (${body.length} caracteres)`, currentState, 'INVALID_OPTION', { stateBefore: currentState, success: false })
}
