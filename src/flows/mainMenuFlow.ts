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

export async function processMainOption(sock: WASocket, userJid: string, userName: string, option: string, currentState: UserState) {
  /**
   * O menu principal decide apenas destinos de alto nível.
   * Cada destino salva o próprio estado antes de aguardar a próxima mensagem,
   * evitando que submenus sejam interpretados como opções do menu inicial.
   */
  switch (option) {
    case '1':
      await sock.sendMessage(userJid, { text: '📚 *Biblioteca*: https://santaines.ifma.edu.br/biblioteca/' })
      await sendFollowUp(sock, userJid)
      await updateUserState(userJid, 'biblioteca')
      await registerUserLog(userJid, userName, 'Menu principal: Biblioteca', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'biblioteca', success: true })
      break

    case '2': {
      await sock.sendMessage(userJid, { text: formatMenu(docsCategoryMenu) })
      const stateAfter = await updateUserState(userJid, 'docs')
      botLog('MENU_OPENED', 'Opção processada', { user: userJid, option, menu: 'menu principal', stateBefore: currentState, stateAfter })
      await registerUserLog(userJid, userName, 'Menu principal: Documentos', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'documentos', success: true })
      break
    }

    case '3': {
      await sock.sendMessage(userJid, { text: formatCourseMenu() })
      const stateAfter = await updateUserState(userJid, 'curso')
      botLog('MENU_OPENED', 'Opção processada', { user: userJid, option, menu: 'menu principal', stateBefore: currentState, stateAfter })
      await registerUserLog(userJid, userName, 'Menu principal: PPC do Curso', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'curso', success: true })
      break
    }

    case '4':
      await sock.sendMessage(userJid, { text: await formatImportantLinksMessage() })
      await sendFollowUp(sock, userJid, 0)
      await updateUserState(userJid, 'links')
      await registerUserLog(userJid, userName, 'Menu principal: Links Importantes', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'links', success: true })
      break

    case '5':
      await sock.sendMessage(userJid, { text: await formatOpenNoticesMessage() })
      await sendFollowUp(sock, userJid, 0)
      await updateUserState(userJid, 'editais')
      await registerUserLog(userJid, userName, 'Menu principal: Editais Abertos', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'editais', success: true })
      break

    case '6':
      await sock.sendMessage(userJid, { text: '🍴 *RU*: Almoço das 11:30 às 13:30.' })
      await sendFollowUp(sock, userJid)
      await updateUserState(userJid, 'ru')
      await registerUserLog(userJid, userName, 'Menu principal: RU', currentState, 'MENU_OPTION_SELECTED', { menu: 'menu principal', stateAfter: 'ru', success: true })
      break

    case '7':
      await openSupportFlow(sock, userJid, userName, currentState)
      await updateUserState(userJid, 'suporte')
      break

    default:
      await sock.sendMessage(userJid, {
        text: `Não consegui entender essa opção. Digite um dos números do menu:\n\n${formatMainMenu()}`
      })
      await registerUserLog(userJid, userName, `Opção inválida no menu principal: ${option}`, currentState, 'INVALID_OPTION', { menu: 'menu principal', success: false })
      break
  }
}
