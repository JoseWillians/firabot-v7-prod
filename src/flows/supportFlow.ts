import { WASocket } from 'baileys'
import { createSupportTicket } from '../functions/database.js'
import { UserState } from '../menus/types.js'
import { errorLog, registerUserLog } from '../services/logService.js'
import { updateUserState } from '../services/userStateService.js'
import { sendFollowUp } from './conversationFlow.js'

export function formatSupportPrompt() {
  return '👨‍💻 *Suporte*\n\nNo momento ainda não temos administradores setoriais atendendo pelo painel. Descreva sua dúvida ou solicitação em uma única mensagem que eu vou registrar aqui.\n\nPor segurança, não envie senha, token, dados bancários ou documentos pessoais completos.'
}

export function formatSupportAcknowledgement() {
  return '✅ Sua mensagem foi registrada. Assim que o suporte setorial estiver disponível, esse fluxo poderá encaminhar sua solicitação para o setor responsável.'
}

export function sanitizeSupportMessage(message: string) {
  return message
    .replace(/\b(senha|password|token|secret)\s*[:=]\s*\S+/gi, '$1: [DADO REMOVIDO]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

export async function openSupportFlow(sock: WASocket, userJid: string, userName: string, currentState: UserState) {
  await sock.sendMessage(userJid, {
    text: formatSupportPrompt()
  })
  await registerUserLog(userJid, userName, 'Menu principal: Suporte aberto', currentState, 'MENU_OPENED', { menu: 'suporte', stateAfter: 'suporte', success: true })
}

const supportDependencies = { createSupportTicket, errorLog, registerUserLog, updateUserState, sendFollowUp }

export async function handleSupportMessage(sock: WASocket, userJid: string, userName: string, message: string, currentState: UserState, overrides: Partial<typeof supportDependencies> = {}) {
  const dependencies = { ...supportDependencies, ...overrides }
  /**
   * Enquanto não existe painel com administradores por setor, o suporte apenas
   * registra a mensagem do usuário e orienta o próximo passo. Quando o painel
   * existir, este ponto vira o handoff para fila/ticket do setor correto.
   *
   * O conteúdo livre não é gravado no log de atendimento para reduzir risco de
   * guardar CPF, matrícula, informação social ou outro dado sensível.
   */
  try {
    await dependencies.createSupportTicket(userJid, userName, sanitizeSupportMessage(message))
  } catch (error) {
    dependencies.errorLog('DATABASE_ERROR', 'Erro ao registrar chamado de suporte na fila administrativa', error, { user: userJid, resultCode: 503 })
    // Sem persistencia confirmada, manter a captura aberta e nunca prometer sucesso.
    await sock.sendMessage(userJid, {
      text: 'Não consegui registrar sua mensagem agora. Tente enviá-la novamente em alguns instantes, digite 0 para voltar ao menu principal ou encerrar para terminar. Código de referência: 503.'
    })
    return
  }

  await dependencies.updateUserState(userJid, 'suporte_confirmacao')
  await dependencies.registerUserLog(userJid, userName, `Mensagem de suporte registrada (${message.length} caracteres)`, currentState, 'SUPPORT_REQUEST', { menu: 'suporte', success: true })
  await sock.sendMessage(userJid, {
    text: formatSupportAcknowledgement()
  })
  await dependencies.sendFollowUp(sock, userJid, 0)
}
