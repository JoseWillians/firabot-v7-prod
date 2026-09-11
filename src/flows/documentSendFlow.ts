import { WASocket } from 'baileys'
import { MenuOption, UserState } from '../menus/types.js'
import { ActiveDocument, formatDocumentSuccessMessage, sendDocument } from '../services/documentService.js'
import { botLog, registerUserLog } from '../services/logService.js'
import { getMenuNameByState } from '../services/menuService.js'
import { sendContextualFollowUp } from './conversationFlow.js'

export interface DocumentSendFlowDependencies {
  sendFile: typeof sendDocument
  sendFollowUp: typeof sendContextualFollowUp
  writeBotLog: typeof botLog
  writeUserLog: typeof registerUserLog
}

const defaultDependencies: DocumentSendFlowDependencies = {
  sendFile: sendDocument,
  sendFollowUp: sendContextualFollowUp,
  writeBotLog: botLog,
  writeUserLog: registerUserLog
}

export async function sendDocumentWithTracking(
  sock: WASocket,
  userJid: string,
  userName: string,
  option: string,
  currentState: UserState,
  document: ActiveDocument,
  menu: string,
  requestedMessage: string,
  sentMessage: string,
  siblingOptions?: MenuOption[],
  dependencyOverrides: Partial<DocumentSendFlowDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }

  await sock.sendMessage(userJid, { text: '👨‍💻 Um momento...' })
  await dependencies.writeUserLog(userJid, userName, requestedMessage, currentState, 'DOCUMENT_REQUESTED', { menu, documentId: document.key })
  const result = await dependencies.sendFile(sock, userJid, document)

  if (!result.success) {
    await dependencies.writeUserLog(userJid, userName, `Erro ao enviar documento: ${document.label}`, currentState, 'DOCUMENT_ERROR', {
      menu,
      documentId: document.key,
      success: false,
      resultCode: result.code
    })
    /**
     * Mesmo quando o arquivo falha, o usuário precisa sair com uma rota clara.
     * Mantemos as opções irmãs do submenu para permitir tentar outro documento
     * sem forçar a pessoa a recomeçar toda a conversa.
     */
    await dependencies.sendFollowUp(sock, userJid, siblingOptions || [], option)
    return
  }

  await sock.sendMessage(userJid, { text: formatDocumentSuccessMessage(document) })
  /**
   * Depois de qualquer documento enviado, mantemos o usuário no submenu atual.
   * Não usamos o follow-up genérico aqui, porque ele esconderia as outras
   * opções do mesmo menu, que é justamente a continuidade esperada.
   */
  await dependencies.sendFollowUp(sock, userJid, siblingOptions || [], option)
  dependencies.writeBotLog('DOCUMENT_SENT', 'Documento enviado', { user: userJid, option, menu: getMenuNameByState(currentState), stateBefore: currentState, stateAfter: currentState, documentId: document.key, resultCode: result.code })
  await dependencies.writeUserLog(userJid, userName, sentMessage, currentState, 'DOCUMENT_SENT', { menu, documentId: document.key, success: true, resultCode: result.code })
}
