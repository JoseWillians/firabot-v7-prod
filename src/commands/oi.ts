import { Command } from '../interfaces/Command.js'
import { sendMainMenu } from '../middlewares/messageHandler.js' //

const oiCommand: Command = {
  name: 'oi',
  description: 'Começa o menu inicial',
  execute: async (sock, msg, args) => {
    const jid = msg.key!.remoteJid!
    await sendMainMenu(sock, jid)
  }
}

export default oiCommand