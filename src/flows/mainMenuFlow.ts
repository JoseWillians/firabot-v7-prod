import { WASocket } from 'baileys'
import { docsCategoryMenu } from '../menus/docsMenu.js'
import { formatOpenNoticesMessage } from '../menus/noticesMenu.js'
import { UserState } from '../menus/types.js'
import { formatImportantLinksMessage } from '../services/importantLinkService.js'
import { botLog, registerUserLog } from '../services/logService.js'
import { formatCourseMenu, formatMainMenu, formatMenu } from '../services/menuService.js'
import { updateUserState } from '../services/userStateService.js'
import { sendFollowUp } from './conversationFlow.js'
import { openSupportFlow } from './supportFlow.js'

export interface MainOptionDependencies {
  formatLinks: typeof formatImportantLinksMessage
  formatNotices: typeof formatOpenNoticesMessage
  sendFollowUp: typeof sendFollowUp
  setState: typeof updateUserState
  openSupport: typeof openSupportFlow
  writeBotLog: typeof botLog
  writeUserLog: typeof registerUserLog
}

const defaultDependencies: MainOptionDependencies = {
  formatLinks: formatImportantLinksMessage,
  formatNotices: formatOpenNoticesMessage,
  sendFollowUp,
  setState: updateUserState,
  openSupport: openSupportFlow,
  writeBotLog: botLog,
  writeUserLog: registerUserLog
}

export async function processMainOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  dependencyOverrides: Partial<MainOptionDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  /**
   * O menu principal decide apenas destinos de alto nível.
   * Cada destino salva o próprio estado antes de aguardar a próxima mensagem,
   * evitando que submenus sejam interpretados como opções do menu inicial.
   */
  switch (option) {
    case '1':
      await sock.sendMessage(userJid, { text: '📚 *Biblioteca*: https://santaines.ifma.edu.br/biblioteca/' })
      await dependencies.sendFollowUp(sock, userJid)
      await dependencies.setState(userJid, 'biblioteca')
      await dependencies.writeUserLog(userJid, userName, 'Menu principal: Biblioteca', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'biblioteca', success: true })
      break

    case '2': {
      await sock.sendMessage(userJid, { text: formatMenu(docsCategoryMenu) })
      const stateAfter = await dependencies.setState(userJid, 'docs')
      dependencies.writeBotLog('MENU_OPENED', 'Opção processada', { user: userJid, option, menu: 'menu principal', stateBefore: currentState, stateAfter })
      await dependencies.writeUserLog(userJid, userName, 'Menu principal: Documentos', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'documentos', success: true })
      break
    }

    case '3': {
      await sock.sendMessage(userJid, { text: formatCourseMenu() })
      const stateAfter = await dependencies.setState(userJid, 'curso')
      dependencies.writeBotLog('MENU_OPENED', 'Opção processada', { user: userJid, option, menu: 'menu principal', stateBefore: currentState, stateAfter })
      await dependencies.writeUserLog(userJid, userName, 'Menu principal: PPC do Curso', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'curso', success: true })
      break
    }

    case '4':
      await sock.sendMessage(userJid, { text: await dependencies.formatLinks() })
      await dependencies.sendFollowUp(sock, userJid, 0)
      await dependencies.setState(userJid, 'links')
      await dependencies.writeUserLog(userJid, userName, 'Menu principal: Links Importantes', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'links', success: true })
      break

    case '5':
      await sock.sendMessage(userJid, { text: await dependencies.formatNotices() })
      await dependencies.sendFollowUp(sock, userJid, 0)
      await dependencies.setState(userJid, 'editais')
      await dependencies.writeUserLog(userJid, userName, 'Menu principal: Editais Abertos', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'editais', success: true })
      break

    case '6':
      await sock.sendMessage(userJid, { text: '🍴 *RU*: Almoço das 11:30 às 13:30.' })
      await dependencies.sendFollowUp(sock, userJid)
      await dependencies.setState(userJid, 'ru')
      await dependencies.writeUserLog(userJid, userName, 'Menu principal: RU', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'ru', success: true })
      break

    case '7':
      await dependencies.openSupport(sock, userJid, userName, currentState)
      await dependencies.setState(userJid, 'suporte')
      break

    default:
      await sock.sendMessage(userJid, {
        text: `Não consegui entender essa opção. Digite um dos números do menu:\n\n${formatMainMenu()}`
      })
      await dependencies.writeUserLog(userJid, userName, `Opção inválida no menu principal: ${option}`, currentState, 'INVALID_OPTION', { menu: 'menu principal', success: false })
      break
  }
}
