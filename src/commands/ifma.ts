import { Command } from '../interfaces/Command.js'

const ifmaCommand: Command = {
  name: 'ifma',
  description: 'Informações úteis do campus',
  execute: async (sock, msg, args) => {
    const info = `*🏛️ INFORMAÇÕES IFMA*\n\n` +
                 `1 *Horários de Aula*: seg-sex (13:15 - 22:00)\n` +
                 `2 *Cardápio RU*:\n` +
                 `3 *Suap*: https://santaines.ifma.edu.br/\n` +
                 `4 *Calendário Acadêmico*: bit.ly/cal-ifma\n\n` +
                 `_Digite o número da opção para saber mais (em breve)_`

    await sock.sendMessage(msg.key!.remoteJid!, { text: info })
  }
}

export default ifmaCommand