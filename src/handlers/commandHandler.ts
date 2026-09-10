import { WASocket, proto } from 'baileys'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { Command } from '../interfaces/Command.js'
import { UserState } from '../menus/types.js'
import { sendEndFlow, sendStartFlow } from '../flows/conversationFlow.js'
import { botLog, errorLog, registerUserLog } from '../services/logService.js'
import { getAdminCommandDenial, resolveAdminAuthorization } from '../services/adminAuthService.js'
import { getJidDomain } from '../services/userIdentityService.js'

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

export interface ProcessCommandDependencies {
  commandRegistry: ReadonlyMap<string, Command>
  ensureCommandsReady: () => Promise<void>
  sendEnd: typeof sendEndFlow
  sendStart: typeof sendStartFlow
  authorizeAdmin: typeof resolveAdminAuthorization
  getAdminDenial: typeof getAdminCommandDenial
  writeTechnicalLog: typeof botLog
  writeUserLog: typeof registerUserLog
  resolveJidDomain: typeof getJidDomain
}

const defaultDependencies: ProcessCommandDependencies = {
  commandRegistry: commands,
  ensureCommandsReady: () => commandsReady,
  sendEnd: sendEndFlow,
  sendStart: sendStartFlow,
  authorizeAdmin: resolveAdminAuthorization,
  getAdminDenial: getAdminCommandDenial,
  writeTechnicalLog: botLog,
  writeUserLog: registerUserLog,
  resolveJidDomain: getJidDomain
}

export async function processCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  body: string,
  userJid: string,
  userName: string,
  currentState: UserState,
  dependencyOverrides: Partial<ProcessCommandDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  if (body.toLowerCase() === '!encerrar') {
    await dependencies.sendEnd(sock, userJid, userName, currentState)
    return
  }

  const commandInput = body.slice(1).trim().toLowerCase()
  const args = commandInput.split(/ +/)
  const commandName = args.shift()

  if (commandName && ['oi', 'menu', 'start', 'ajuda'].includes(commandName)) {
    await dependencies.sendStart(sock, userJid, userName, `Início: !${commandName}`)
    return
  }

  await dependencies.ensureCommandsReady()

  if (commandName && dependencies.commandRegistry.has(commandName)) {
    const command = dependencies.commandRegistry.get(commandName)

    const adminAuthorization = command?.adminOnly
      ? await dependencies.authorizeAdmin(sock, msg)
      : null

    if (command?.adminOnly && !adminAuthorization?.authorized) {
      const denial = dependencies.getAdminDenial()

      await sock.sendMessage(userJid, { text: denial.message })
      dependencies.writeTechnicalLog('COMMAND_DENIED', 'Comando administrativo bloqueado', {
        user: userJid,
        command: commandName,
        adminsConfigured: denial.adminsConfigured,
        jidDomain: dependencies.resolveJidDomain(userJid),
        authorizationSource: adminAuthorization?.source,
        lidMappingAttempted: adminAuthorization?.lidMappingAttempted,
        databaseLookupAttempted: adminAuthorization?.databaseLookupAttempted,
        stateBefore: currentState,
        resultCode: denial.code
      })
      await dependencies.writeUserLog(userJid, userName, `Comando restrito negado: !${commandName}`, currentState, 'COMMAND_DENIED', {
        command: commandName,
        success: false,
        resultCode: denial.code
      })
      return
    }

    await command?.execute(sock, msg, args)
    if (command?.adminOnly) {
      dependencies.writeTechnicalLog('COMMAND_EXECUTED', 'Comando administrativo autorizado', {
        user: userJid,
        command: commandName,
        authorizationSource: adminAuthorization?.source,
        stateBefore: currentState
      })
    }
    await dependencies.writeUserLog(userJid, userName, `Comando: !${commandName}`, currentState, 'COMMAND_EXECUTED', { command: commandName, success: true })
    return
  }

  await sock.sendMessage(userJid, { text: '⚠️ Comando não reconhecido. Use !help para ver os comandos disponíveis. Código de referência: 404.' })
  await dependencies.writeUserLog(userJid, userName, `Comando desconhecido: ${commandName || 'vazio'}`, currentState, 'COMMAND_UNKNOWN', { command: commandName || 'vazio', success: false })
}
