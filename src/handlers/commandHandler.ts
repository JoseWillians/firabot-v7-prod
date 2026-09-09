import { WASocket, proto } from 'baileys'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { Command } from '../interfaces/Command.js'
import { UserState } from '../menus/types.js'
import { sendEndFlow, sendStartFlow } from '../flows/conversationFlow.js'
import { botLog, errorLog, registerUserLog } from '../services/logService.js'
import { hasConfiguredAdmins, resolveAdminAuthorization } from '../services/adminAuthService.js'
import { getJidDomain } from '../services/userIdentityService.js'
import { BotResultCode } from '../types/resultCode.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const commands = new Map<string, Command>()

const loadCommands = async () => {
  const commandsPath = path.join(__dirname, '../commands')
  if (!fs.existsSync(commandsPath)) return

  commands.clear()
  const files = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'))
  for (const file of files) {
    const { default: cmd } = await import(`../commands/${file}`)
    if (cmd?.name) {
      commands.set(cmd.name, cmd)
      cmd.alias?.forEach((alias: string) => commands.set(alias, cmd))
    }
  }
}

const commandsReady = loadCommands().catch(error => {
  errorLog('UNKNOWN_ERROR', 'Erro ao carregar comandos', error)
})

export async function processCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  body: string,
  userJid: string,
  userName: string,
  currentState: UserState
) {
  if (body.toLowerCase() === '!encerrar') {
    await sendEndFlow(sock, userJid, userName, currentState)
    return
  }

  await commandsReady

  const commandInput = body.slice(1).trim().toLowerCase()
  const args = commandInput.split(/ +/)
  const commandName = args.shift()

  if (commandName && ['oi', 'menu', 'start', 'ajuda'].includes(commandName)) {
    await sendStartFlow(sock, userJid, userName, `Início: !${commandName}`)
    return
  }

  if (commandName && commands.has(commandName)) {
    const command = commands.get(commandName)

    const adminAuthorization = command?.adminOnly
      ? await resolveAdminAuthorization(sock, msg)
      : null

    if (command?.adminOnly && !adminAuthorization?.authorized) {
      const adminsConfigured = hasConfiguredAdmins()
      const resultCode = adminsConfigured ? BotResultCode.FORBIDDEN : BotResultCode.SERVICE_UNAVAILABLE
      const denialMessage = adminsConfigured
        ? '⚠️ Comando restrito a administradores autorizados. Código de referência: 403.'
        : '⚠️ Os comandos administrativos ainda não foram configurados. Verifique ADMIN_NUMBERS e reinicie o bot. Código de referência: 503.'

      await sock.sendMessage(userJid, { text: denialMessage })
      botLog('COMMAND_DENIED', 'Comando administrativo bloqueado', {
        user: userJid,
        command: commandName,
        adminsConfigured,
        jidDomain: getJidDomain(userJid),
        authorizationSource: adminAuthorization?.source,
        lidMappingAttempted: adminAuthorization?.lidMappingAttempted,
        databaseLookupAttempted: adminAuthorization?.databaseLookupAttempted,
        stateBefore: currentState,
        resultCode
      })
      await registerUserLog(userJid, userName, `Comando restrito negado: !${commandName}`, currentState, 'COMMAND_DENIED', {
        command: commandName,
        success: false,
        resultCode
      })
      return
    }

    await command?.execute(sock, msg, args)
    if (command?.adminOnly) {
      botLog('COMMAND_EXECUTED', 'Comando administrativo autorizado', {
        user: userJid,
        command: commandName,
        authorizationSource: adminAuthorization?.source,
        stateBefore: currentState
      })
    }
    await registerUserLog(userJid, userName, `Comando: !${commandName}`, currentState, 'COMMAND_EXECUTED', { command: commandName, success: true })
    return
  }

  await sock.sendMessage(userJid, { text: '⚠️ Comando não reconhecido. Use !help para ver os comandos disponíveis. Código de referência: 404.' })
  await registerUserLog(userJid, userName, `Comando desconhecido: ${commandName || 'vazio'}`, currentState, 'COMMAND_UNKNOWN', { command: commandName || 'vazio', success: false })
}
