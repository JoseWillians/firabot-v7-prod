import { Command } from '../interfaces/Command.js'
import { sendMainMenu } from '../flows/conversationFlow.js'

const oiCommand: Command = {
  name: 'oi',
  description: 'Começa o menu inicial',
  execute: async (sock, msg) => {
    const jid = msg.key!.remoteJid!
    await sendMainMenu(sock, jid)
  }
}

export default oiCommand
