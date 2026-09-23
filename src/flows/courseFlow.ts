import { WASocket } from 'baileys'
import { findCourseByOption } from '../menus/courseMenu.js'
import { UserState } from '../menus/types.js'
import { registerUserLog } from '../services/logService.js'
import { formatCourseMenu, getMenuNameByState } from '../services/menuService.js'
import { formatDocumentCatalog, loadDocumentCatalog } from './documentCatalogFlow.js'
import { isDocumentMenuCurrent, rememberDocumentMenu } from '../services/documentMenuSnapshotService.js'
import { updateUserState } from '../services/userStateService.js'
import { getAvailablePpcDocuments } from '../services/courseDocumentService.js'
import { sendDocumentWithTracking } from './documentSendFlow.js'

export interface CourseFlowDependencies {
  setState: typeof updateUserState
  writeUserLog: typeof registerUserLog
  listPpcs: typeof getAvailablePpcDocuments
  sendTracked: typeof sendDocumentWithTracking
}

const defaultDependencies: CourseFlowDependencies = {
  setState: updateUserState,
  writeUserLog: registerUserLog,
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
    const documents = await loadDocumentCatalog(sock, userJid, () => dependencies.listPpcs(course.state))
    if (documents === null) return
    await sock.sendMessage(userJid, { text: formatDocumentCatalog(documents, course.label) })
    rememberDocumentMenu(userJid, course.state, documents)
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
  const documents = await loadDocumentCatalog(sock, userJid, () => dependencies.listPpcs(currentState))
  if (documents === null) return
  const menuText = formatDocumentCatalog(documents, getMenuNameByState(currentState))
  const current = isDocumentMenuCurrent(userJid, currentState, documents)
  const document = current ? documents.find(item => item.key === option) : undefined

  if (!document) {
    await sock.sendMessage(userJid, {
      text: documents.length
        ? `${current ? 'Não consegui entender essa opção no menu de PPC.' : 'Atualizei a lista de PPCs. Escolha novamente para confirmar o arquivo.'}\n\n${menuText}`
        : menuText
    })
    rememberDocumentMenu(userJid, currentState, documents)
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
    documents
  )
}
