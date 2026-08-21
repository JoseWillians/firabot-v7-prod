import { WASocket } from 'baileys'
import { createSupportTicket } from '../functions/database.js'
import { UserState } from '../menus/types.js'
import { errorLog, registerUserLog } from '../services/logService.js'
import { updateUserState } from '../services/userStateService.js'
import { sendFollowUp } from './conversationFlow.js'

export function formatSupportPrompt() {
  return '👨‍💻 *Suporte*\n\nNo momento ainda não temos administradores setoriais atendendo pelo painel. Descreva sua dúvida ou solicitação em uma única mensagem que eu vou registrar aqui.'
}

export function formatSupportAcknowledgement() {
  return '✅ Sua mensagem foi registrada. Assim que o suporte setorial estiver disponível, esse fluxo poderá encaminhar sua solicitação para o setor responsável.'
}

export async function openSupportFlow(sock: WASocket, userJid: string, userName: string, currentState: UserState) {
  await sock.sendMessage(userJid, {
    text: formatSupportPrompt()
  })
  await registerUserLog(userJid, userName, 'Menu principal: Suporte aberto', currentState, 'MENU_OPENED', { menu: 'suporte', stateAfter: 'suporte', success: true })
}

export async function handleSupportMessage(sock: WASocket, userJid: string, userName: string, message: string, currentState: UserState) {
  /**
   * Enquanto não existe painel com administradores por setor, o suporte apenas
   * registra a mensagem do usuário e orienta o próximo passo. Quando o painel
   * existir, este ponto vira o handoff para fila/ticket do setor correto.
   *
   * O conteúdo livre não é gravado no log de atendimento para reduzir risco de
   * guardar CPF, matrícula, informação social ou outro dado sensível.
   */
  try {
    await createSupportTicket(userJid, userName, message)
  } catch (error) {
    errorLog('DATABASE_ERROR', 'Erro ao registrar chamado de suporte na fila administrativa', error, { user: userJid })
  }

  await registerUserLog(userJid, userName, `Mensagem de suporte registrada (${message.length} caracteres)`, currentState, 'SUPPORT_REQUEST', { menu: 'suporte', success: true })
  await sock.sendMessage(userJid, {
    text: formatSupportAcknowledgement()
  })
  await updateUserState(userJid, 'suporte_confirmacao')
  await sendFollowUp(sock, userJid, 0)
}
