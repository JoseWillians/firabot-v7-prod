import { WASocket } from 'baileys'
import { docsCategoryMenu, emptyCaeDocsMenu } from '../menus/docsMenu.js'
import { UserState } from '../menus/types.js'
import { getAvailableDocuments } from '../services/documentService.js'
import { registerUserLog } from '../services/logService.js'
import { formatMenu } from '../services/menuService.js'
import { updateUserState } from '../services/userStateService.js'
import { sendDocumentWithTracking } from './documentSendFlow.js'
import { isDocumentMenuCurrent, rememberDocumentMenu } from '../services/documentMenuSnapshotService.js'
import { formatDocumentCatalog, loadDocumentCatalog } from './documentCatalogFlow.js'

export interface DocumentsFlowDependencies {
  listDocuments: typeof getAvailableDocuments
  setState: typeof updateUserState
  writeUserLog: typeof registerUserLog
  sendTracked: typeof sendDocumentWithTracking
}

const defaultDependencies: DocumentsFlowDependencies = {
  listDocuments: getAvailableDocuments,
  setState: updateUserState,
  writeUserLog: registerUserLog,
  sendTracked: sendDocumentWithTracking
}

export async function processDocsCategoryOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  dependencyOverrides: Partial<DocumentsFlowDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  /**
   * O menu Documentos separa setores antes de listar arquivos.
   * Isso prepara DRCA e CAE para crescerem de forma independente sem misturar
   * documentos acadêmicos de áreas diferentes.
   */
  if (option === '1') {
    const documents = await loadDocumentCatalog(sock, userJid, () => dependencies.listDocuments('drca'))
    if (documents === null) return
    await sock.sendMessage(userJid, { text: formatDocumentCatalog(documents) })
    rememberDocumentMenu(userJid, 'docs_drca', documents)
    const stateAfter = await dependencies.setState(userJid, 'docs_drca')
    await dependencies.writeUserLog(userJid, userName, 'Documentos: DRCA', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'documentos drca', success: true })
    return
  }

  if (option === '2') {
    const caeDocuments = await loadDocumentCatalog(sock, userJid, () => dependencies.listDocuments('cae'))
    if (caeDocuments === null) return
    await sock.sendMessage(userJid, {
      text: caeDocuments.length
        ? formatDocumentCatalog(caeDocuments, '📄 *DOCUMENTOS CAE*')
        : formatMenu(emptyCaeDocsMenu)
    })
    rememberDocumentMenu(userJid, 'docs_cae', caeDocuments)
    const stateAfter = await dependencies.setState(userJid, 'docs_cae')
    await dependencies.writeUserLog(userJid, userName, 'Documentos: CAE', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'documentos cae', success: true })
    return
  }

  await sock.sendMessage(userJid, {
    text: `Não consegui entender essa opção no menu de documentos. Escolha uma opção válida:\n\n${formatMenu(docsCategoryMenu)}`
  })
  await dependencies.writeUserLog(userJid, userName, `Opção inválida em documentos: ${option}`, currentState, 'INVALID_OPTION', { menu: 'documentos', success: false })
}

export async function processDrcaDocsOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  dependencyOverrides: Partial<DocumentsFlowDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  /**
   * Documentos são resolvidos por opção dinâmica; o banco define a lista ativa.
   * Isso permite adicionar/remover PDFs sem alterar o fluxo principal.
   */
  const documents = await loadDocumentCatalog(sock, userJid, () => dependencies.listDocuments('drca'))
  if (documents === null) return
  const current = isDocumentMenuCurrent(userJid, currentState, documents)
  const document = current ? documents.find(item => item.key === option) : undefined

  if (!document) {
    await sock.sendMessage(userJid, {
      text: documents.length
        ? `${current ? 'Não consegui entender essa opção.' : 'Atualizei a lista de documentos. Escolha novamente para confirmar o arquivo.'}\n\n${formatDocumentCatalog(documents)}`
        : formatDocumentCatalog(documents)
    })
    rememberDocumentMenu(userJid, currentState, documents)
    await dependencies.writeUserLog(userJid, userName, `Opção inválida em documentos: ${option}`, currentState, 'INVALID_OPTION', { menu: 'documentos', success: false })
    return
  }

  await dependencies.sendTracked(
    sock,
    userJid,
    userName,
    option,
    currentState,
    document,
    'documentos',
    `Documento solicitado: ${document.label}`,
    `Documento enviado: ${document.label}`,
    documents
  )
}

export async function processCaeDocsOption(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  dependencyOverrides: Partial<DocumentsFlowDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  /**
   * A CAE usa a mesma resolução dinâmica da DRCA.
   * Se o painel cadastrar um PDF ativo com category_code = "cae", ele passa a
   * aparecer no menu e pode ser enviado pelo bot sem reinserir opções no código.
   */
  const documents = await loadDocumentCatalog(sock, userJid, () => dependencies.listDocuments('cae'))
  if (documents === null) return
  const current = isDocumentMenuCurrent(userJid, currentState, documents)
  const document = current ? documents.find(item => item.key === option) : undefined

  if (!document) {
    await sock.sendMessage(userJid, {
      text: documents.length
        ? `${current ? 'Não consegui entender essa opção.' : 'Atualizei a lista de documentos. Escolha novamente para confirmar o arquivo.'}\n\n${formatDocumentCatalog(documents, '📄 *DOCUMENTOS CAE*')}`
        : `Ainda não há documentos da CAE cadastrados para envio automático.\n\n${formatMenu(emptyCaeDocsMenu)}`
    })
    rememberDocumentMenu(userJid, currentState, documents)
    await dependencies.writeUserLog(userJid, userName, `Opção inválida em documentos CAE: ${option}`, currentState, 'INVALID_OPTION', { menu: 'documentos cae', success: false })
    return
  }

  await dependencies.sendTracked(
    sock,
    userJid,
    userName,
    option,
    currentState,
    document,
    'documentos cae',
    `Documento CAE solicitado: ${document.label}`,
    `Documento CAE enviado: ${document.label}`,
    documents
  )
}
