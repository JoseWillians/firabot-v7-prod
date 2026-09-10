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

export interface MenuOptionDependencies {
  sendMain: typeof sendMainMenu
  sendUnknown: typeof sendUnknownMessage
  updateState: typeof updateUserState
  writeBotLog: typeof botLog
  writeUserLog: typeof registerUserLog
  handleDocsCategory: typeof processDocsCategoryOption
  handleDrcaDocs: typeof processDrcaDocsOption
  handleCaeDocs: typeof processCaeDocsOption
  handleCourseSelection: typeof processCourseSelectionOption
  handlePpcDocument: typeof processPpcDocumentOption
  handleMainOption: typeof processMainOption
}

const defaultDependencies: MenuOptionDependencies = {
  sendMain: sendMainMenu,
  sendUnknown: sendUnknownMessage,
  updateState: updateUserState,
  writeBotLog: botLog,
  writeUserLog: registerUserLog,
  handleDocsCategory: processDocsCategoryOption,
  handleDrcaDocs: processDrcaDocsOption,
  handleCaeDocs: processCaeDocsOption,
  handleCourseSelection: processCourseSelectionOption,
  handlePpcDocument: processPpcDocumentOption,
  handleMainOption: processMainOption
}

export async function processMenuOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  dependencyOverrides: Partial<MenuOptionDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  /**
   * Este handler é só o roteador das opções numéricas.
   * A regra de negócio de cada área fica em um arquivo de fluxo próprio, para
   * evitar que o antigo messageHandler volte a concentrar todo o chatbot.
   */
  if (option === '0' && currentState !== 'main') {
    await dependencies.sendMain(sock, userJid)
    const stateAfter = await dependencies.updateState(userJid, 'main')
    dependencies.writeBotLog('MENU_OPTION_SELECTED', 'Opção processada', { user: userJid, option, menu: getMenuNameByState(currentState), stateBefore: currentState, stateAfter })
    await dependencies.writeUserLog(userJid, userName, 'Voltou ao menu principal', currentState, 'USER_STATE_CHANGED', { stateBefore: currentState, stateAfter, menu: 'menu principal', success: true })
    return
  }

  if (isInformationalSubmenuState(currentState)) {
    await dependencies.sendUnknown(sock, userJid, currentState)
    await dependencies.writeUserLog(userJid, userName, `Opção inválida em ${getMenuNameByState(currentState)}: ${option}`, currentState, 'INVALID_OPTION', { menu: getMenuNameByState(currentState), success: false })
    return
  }

  const route = getMenuRouteForOption(currentState, option)

  if (route === 'docs') {
    await dependencies.handleDocsCategory(sock, userJid, userName, option, currentState)
    return
  }

  if (route === 'docs_drca') {
    await dependencies.handleDrcaDocs(sock, userJid, userName, option, currentState)
    return
  }

  if (route === 'docs_cae') {
    await dependencies.handleCaeDocs(sock, userJid, userName, option, currentState)
    return
  }

  if (route === 'curso') {
    await dependencies.handleCourseSelection(sock, userJid, userName, option, currentState)
    return
  }

  if (route.startsWith('curso_')) {
    await dependencies.handlePpcDocument(sock, userJid, userName, option, currentState)
    return
  }

  await dependencies.handleMainOption(sock, userJid, userName, option, currentState)
}

function isInformationalSubmenuState(state: UserState) {
  return ['biblioteca', 'links', 'editais', 'ru', 'suporte', 'suporte_confirmacao', 'encerrado'].includes(state)
}
