import { WASocket } from 'baileys'
import { UserState } from '../menus/types.js'
import { processCourseSelectionOption, processPpcDocumentOption } from '../flows/courseFlow.js'
import { processCaeDocsOption, processDocsCategoryOption, processDrcaDocsOption } from '../flows/documentsFlow.js'
import { processMainOption } from '../flows/mainMenuFlow.js'
import { sendMainMenu, sendUnknownMessage } from '../flows/conversationFlow.js'
import { botLog, registerUserLog } from '../services/logService.js'
import { getMenuNameByState } from '../services/menuService.js'
import { getMenuRouteForOption } from '../services/menuRoutingService.js'
import { updateUserState } from '../services/userStateService.js'

export async function processMenuOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState
) {
  /**
   * Este handler é só o roteador das opções numéricas.
   * A regra de negócio de cada área fica em um arquivo de fluxo próprio, para
   * evitar que o antigo messageHandler volte a concentrar todo o chatbot.
   */
  if (option === '0' && currentState !== 'main') {
    await sendMainMenu(sock, userJid)
    const stateAfter = await updateUserState(userJid, 'main')
    botLog('MENU_OPTION_SELECTED', 'Opção processada', { user: userJid, option, menu: getMenuNameByState(currentState), stateBefore: currentState, stateAfter })
    await registerUserLog(userJid, userName, 'Voltou ao menu principal', currentState, 'USER_STATE_CHANGED', { stateBefore: currentState, stateAfter, menu: 'menu principal', success: true })
    return
  }

  if (isInformationalSubmenuState(currentState)) {
    await sendUnknownMessage(sock, userJid, currentState)
    await registerUserLog(userJid, userName, `Opção inválida em ${getMenuNameByState(currentState)}: ${option}`, currentState, 'INVALID_OPTION', { menu: getMenuNameByState(currentState), success: false })
    return
  }

  const route = getMenuRouteForOption(currentState, option)

  if (route === 'docs') {
    await processDocsCategoryOption(sock, userJid, userName, option, currentState)
    return
  }

  if (route === 'docs_drca') {
    await processDrcaDocsOption(sock, userJid, userName, option, currentState)
    return
  }

  if (route === 'docs_cae') {
    await processCaeDocsOption(sock, userJid, userName, option, currentState)
    return
  }

  if (route === 'curso') {
    await processCourseSelectionOption(sock, userJid, userName, option, currentState)
    return
  }

  if (route.startsWith('curso_')) {
    await processPpcDocumentOption(sock, userJid, userName, option, currentState)
    return
  }

  await processMainOption(sock, userJid, userName, option, currentState)
}

function isInformationalSubmenuState(state: UserState) {
  return ['biblioteca', 'links', 'editais', 'ru', 'suporte', 'suporte_confirmacao', 'encerrado'].includes(state)
}
