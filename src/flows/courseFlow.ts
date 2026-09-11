import { WASocket } from 'baileys'
import { findCourseByOption } from '../menus/courseMenu.js'
import { UserState } from '../menus/types.js'
import { registerUserLog } from '../services/logService.js'
import { formatCourseMenu, formatPpcMenuByState, getMenuNameByState } from '../services/menuService.js'
import { updateUserState } from '../services/userStateService.js'
import { findPpcDocumentByOption, getAvailablePpcDocuments } from '../services/courseDocumentService.js'
import { sendDocumentWithTracking } from './documentSendFlow.js'

export interface CourseFlowDependencies {
  setState: typeof updateUserState
  writeUserLog: typeof registerUserLog
  findPpc: typeof findPpcDocumentByOption
  listPpcs: typeof getAvailablePpcDocuments
  sendTracked: typeof sendDocumentWithTracking
}

const defaultDependencies: CourseFlowDependencies = {
  setState: updateUserState,
  writeUserLog: registerUserLog,
  findPpc: findPpcDocumentByOption,
  listPpcs: getAvailablePpcDocuments,
  sendTracked: sendDocumentWithTracking
}

export async function processCourseSelectionOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  dependencyOverrides: Partial<CourseFlowDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }
  const course = findCourseByOption(option)

  if (course) {
    await sock.sendMessage(userJid, { text: formatPpcMenuByState(course.state) || formatCourseMenu() })
    const stateAfter = await dependencies.setState(userJid, course.state)
    await dependencies.writeUserLog(userJid, userName, `Curso selecionado: ${course.label}`, currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: getMenuNameByState(stateAfter), success: true })
    return
  }

  await sock.sendMessage(userJid, {
    text: `Não consegui entender essa opção no menu de cursos. Escolha uma opção válida:\n\n${formatCourseMenu()}`
  })
  await dependencies.writeUserLog(userJid, userName, `Opção inválida em curso: ${option}`, currentState, 'INVALID_OPTION', { menu: 'curso', success: false })
}

export async function processPpcDocumentOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  dependencyOverrides: Partial<CourseFlowDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }
  const menuText = formatPpcMenuByState(currentState) || formatCourseMenu()
  const document = await dependencies.findPpc(currentState, option)

  if (!document) {
    await sock.sendMessage(userJid, {
      text: `Não consegui entender essa opção no menu de PPC. Escolha uma opção válida:\n\n${menuText}`
    })
    await dependencies.writeUserLog(userJid, userName, `Opção inválida em PPC: ${option}`, currentState, 'INVALID_OPTION', { menu: getMenuNameByState(currentState), success: false })
    return
  }

  await dependencies.sendTracked(
    sock,
    userJid,
    userName,
    option,
    currentState,
    document,
    'curso',
    `PPC solicitado: ${document.label}`,
    `PPC enviado: ${document.label}`,
    await dependencies.listPpcs(currentState)
  )
}
