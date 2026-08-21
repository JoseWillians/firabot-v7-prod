import { WASocket } from 'baileys'
import { MenuOption, UserState } from '../menus/types.js'
import { ActiveDocument, formatDocumentSuccessMessage, sendDocument } from '../services/documentService.js'
import { botLog, registerUserLog } from '../services/logService.js'
import { getMenuNameByState } from '../services/menuService.js'
import { sendContextualFollowUp } from './conversationFlow.js'

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
  siblingOptions?: MenuOption[]
) {
  await sock.sendMessage(userJid, { text: '👨‍💻 Um momento...' })
  await registerUserLog(userJid, userName, requestedMessage, currentState, 'DOCUMENT_REQUESTED', { menu, documentId: document.key })
  const result = await sendDocument(sock, userJid, document)

  if (!result.success) {
    await registerUserLog(userJid, userName, `Erro ao enviar documento: ${document.label}`, currentState, 'DOCUMENT_ERROR', {
      menu,
      documentId: document.key,
      success: false,
      errorMessage: result.errorMessage
    })
    /**
     * Mesmo quando o arquivo falha, o usuário precisa sair com uma rota clara.
     * Mantemos as opções irmãs do submenu para permitir tentar outro documento
     * sem forçar a pessoa a recomeçar toda a conversa.
     */
    await sendContextualFollowUp(sock, userJid, siblingOptions || [], option)
    return
  }

  await sock.sendMessage(userJid, { text: formatDocumentSuccessMessage(document) })
  /**
   * Depois de qualquer documento enviado, mantemos o usuário no submenu atual.
   * Não usamos o follow-up genérico aqui, porque ele esconderia as outras
   * opções do mesmo menu, que é justamente a continuidade esperada.
   */
  await sendContextualFollowUp(sock, userJid, siblingOptions || [], option)
  botLog('DOCUMENT_SENT', 'Documento enviado', { user: userJid, option, menu: getMenuNameByState(currentState), stateBefore: currentState, stateAfter: currentState, documentId: document.key })
  await registerUserLog(userJid, userName, sentMessage, currentState, 'DOCUMENT_SENT', { menu, documentId: document.key, success: true })
}
