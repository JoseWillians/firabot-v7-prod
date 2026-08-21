import { WASocket } from 'baileys'
import { docsCategoryMenu, emptyCaeDocsMenu } from '../menus/docsMenu.js'
import { UserState } from '../menus/types.js'
import { findDocumentByOption, formatDocumentsMenu, getAvailableDocuments } from '../services/documentService.js'
import { registerUserLog } from '../services/logService.js'
import { formatMenu } from '../services/menuService.js'
import { updateUserState } from '../services/userStateService.js'
import { sendDocumentWithTracking } from './documentSendFlow.js'

export async function processDocsCategoryOption(sock: WASocket, userJid: string, userName: string, option: string, currentState: UserState) {
  /**
   * O menu Documentos separa setores antes de listar arquivos.
   * Isso prepara DRCA e CAE para crescerem de forma independente sem misturar
   * documentos acadêmicos de áreas diferentes.
   */
  if (option === '1') {
    await sock.sendMessage(userJid, { text: await formatDocumentsMenu() })
    const stateAfter = await updateUserState(userJid, 'docs_drca')
    await registerUserLog(userJid, userName, 'Documentos: DRCA', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'documentos drca', success: true })
    return
  }

  if (option === '2') {
    const caeDocuments = await getAvailableDocuments('cae')
    await sock.sendMessage(userJid, {
      text: caeDocuments.length
        ? await formatDocumentsMenu('cae', '📄 *DOCUMENTOS CAE*')
        : formatMenu(emptyCaeDocsMenu)
    })
    const stateAfter = await updateUserState(userJid, 'docs_cae')
    await registerUserLog(userJid, userName, 'Documentos: CAE', currentState, 'MENU_OPENED', { stateBefore: currentState, stateAfter, menu: 'documentos cae', success: true })
    return
  }

  await sock.sendMessage(userJid, {
    text: `Não consegui entender essa opção no menu de documentos. Escolha uma opção válida:\n\n${formatMenu(docsCategoryMenu)}`
  })
  await registerUserLog(userJid, userName, `Opção inválida em documentos: ${option}`, currentState, 'INVALID_OPTION', { menu: 'documentos', success: false })
}

export async function processDrcaDocsOption(sock: WASocket, userJid: string, userName: string, option: string, currentState: UserState) {
  /**
   * Documentos são resolvidos por opção dinâmica; o banco define a lista ativa.
   * Isso permite adicionar/remover PDFs sem alterar o fluxo principal.
   */
  const document = await findDocumentByOption(option)

  if (!document) {
    await sock.sendMessage(userJid, {
      text: `Não consegui entender essa opção no menu de documentos. Escolha uma opção válida:\n\n${await formatDocumentsMenu()}`
    })
    await registerUserLog(userJid, userName, `Opção inválida em documentos: ${option}`, currentState, 'INVALID_OPTION', { menu: 'documentos', success: false })
    return
  }

  await sendDocumentWithTracking(
    sock,
    userJid,
    userName,
    option,
    currentState,
    document,
    'documentos',
    `Documento solicitado: ${document.label}`,
    `Documento enviado: ${document.label}`,
    await getAvailableDocuments('drca')
  )
}

export async function processCaeDocsOption(sock: WASocket, userJid: string, userName: string, option: string, currentState: UserState) {
  /**
   * A CAE usa a mesma resolução dinâmica da DRCA.
   * Se o painel cadastrar um PDF ativo com category_code = "cae", ele passa a
   * aparecer no menu e pode ser enviado pelo bot sem reinserir opções no código.
   */
  const documents = await getAvailableDocuments('cae')
  const document = await findDocumentByOption(option, 'cae')

  if (!document) {
    await sock.sendMessage(userJid, {
      text: documents.length
        ? `Não consegui entender essa opção no menu de documentos CAE. Escolha uma opção válida:\n\n${await formatDocumentsMenu('cae', '📄 *DOCUMENTOS CAE*')}`
        : `Ainda não há documentos da CAE cadastrados para envio automático.\n\n${formatMenu(emptyCaeDocsMenu)}`
    })
    await registerUserLog(userJid, userName, `Opção inválida em documentos CAE: ${option}`, currentState, 'INVALID_OPTION', { menu: 'documentos cae', success: false })
    return
  }

  await sendDocumentWithTracking(
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
