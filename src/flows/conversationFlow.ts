import { WASocket } from 'baileys'
import { config } from '../config.js'
import { MenuOption, UserState } from '../menus/types.js'
import { formatContextualFollowUpMessage } from '../services/followUpMenuService.js'
import { botLog, registerUserLog } from '../services/logService.js'
import { formatMainMenu, getMenuNameByState } from '../services/menuService.js'
import { updateUserState } from '../services/userStateService.js'

export async function sendStartFlow(sock: WASocket, userJid: string, userName: string, logMessage: string) {
  await sendWelcome(sock, userJid, userName)
  await sendMainMenu(sock, userJid)
  const stateAfter = await updateUserState(userJid, 'main')
  botLog('USER_STATE_CHANGED', 'Estado atualizado', { user: userJid, stateAfter, menu: 'início' })
  await registerUserLog(userJid, userName, logMessage, stateAfter, 'USER_STATE_CHANGED', { stateAfter, menu: 'menu principal', success: true })
}

async function sendWelcome(sock: WASocket, jid: string, name: string) {
  const welcomeText = `👋 Olá, *${name}*!\n\n` +
                      `Eu sou o *${config.botName}*, o assistente virtual dos estudantes do ${config.campus}. 🤖💻\n\n` +
                      'Estou aqui para facilitar seu acesso a documentos e informações importantes. (Fase de testes)'
  await sock.sendMessage(jid, { text: welcomeText })
  await new Promise(resolve => setTimeout(resolve, 800))
}

export async function sendFollowUp(sock: WASocket, jid: string, delayMs = 1500) {
  const followUpText = `🤖 *ASSISTENTE IFMA*\n\n` +
                       `Você deseja mais alguma coisa?\n\n` +
                       `0 - Voltar ao Menu Principal\n` +
                       `encerrar - Terminar conversa\n\n` +
                       `_(Digite "encerrar" para terminar a conversa)_`

  const send = async () => {
    try {
      await sock.sendMessage(jid, { text: followUpText })
    } catch (error) {
      botLog('WHATSAPP_SEND_ERROR', 'Falha ao enviar mensagem de acompanhamento', { user: jid, error })
    }
  }

  if (delayMs <= 0) {
    await send()
    return
  }

  setTimeout(send, delayMs)
}

export async function sendContextualFollowUp(sock: WASocket, jid: string, options: MenuOption[], selectedOption: string) {
  /**
   * Depois de enviar um documento, o usuário normalmente ainda está dentro do
   * mesmo submenu. Mostrar as opções irmãs evita obrigar a pessoa a voltar ao
   * menu anterior só para pedir outro arquivo relacionado.
   */
  const followUpText = formatContextualFollowUpMessage(options, selectedOption)

  setTimeout(async () => {
    try {
      await sock.sendMessage(jid, { text: followUpText })
    } catch (error) {
      botLog('WHATSAPP_SEND_ERROR', 'Falha ao enviar mensagem contextual de acompanhamento', { user: jid, error })
    }
  }, 1500)
}

export async function sendUnknownMessage(sock: WASocket, jid: string, state: UserState) {
  const menuName = getMenuNameByState(state)
  if (state === 'main') {
    await sock.sendMessage(jid, {
      text: `Não entendi essa mensagem. Digite uma opção do menu principal ou envie "menu" para reiniciar.\n\n${formatMainMenu()}`
    })
    return
  }

  if (state === 'encerrado') {
    await sock.sendMessage(jid, {
      text: 'Este atendimento foi encerrado. Para começar novamente, envie oi ou menu.'
    })
    return
  }

  await sock.sendMessage(jid, {
    text: `Não entendi essa mensagem. Digite uma opção numérica do ${menuName}, "0" para voltar ao menu principal ou "menu" para reiniciar.`
  })
}

export async function sendEndFlow(sock: WASocket, userJid: string, userName: string, currentState: UserState) {
  await sock.sendMessage(userJid, {
    text: `👋 *Atendimento Encerrado.*\nO ${config.botName} agradece o seu contato! Se precisar de algo novo, basta digitar oi ou menu.`
  })
  const stateAfter = await updateUserState(userJid, 'encerrado')
  botLog('USER_STATE_CHANGED', 'Atendimento encerrado', { user: userJid, stateBefore: currentState, stateAfter, menu: 'encerramento' })
  await registerUserLog(userJid, userName, 'Sessão Encerrada', currentState, 'USER_STATE_CHANGED', { stateBefore: currentState, stateAfter, success: true })
}

export async function sendMainMenu(sock: WASocket, jid: string) {
  await sock.sendMessage(jid, { text: formatMainMenu() })
}
