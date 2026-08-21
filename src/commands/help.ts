import { Command } from '../interfaces/Command.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { isAdminJid } from '../services/adminAuthService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const helpCommand: Command = {
  name: 'help',
  description: 'Lista todos os comandos disponíveis e a finalidade do bot',
  alias: ['ajuda', 'menu'],
  execute: async (sock, msg, args) => {
    const remoteJid = msg.key?.remoteJid || ''
    const isAdmin = isAdminJid(remoteJid)
    const commandsPath = path.join(__dirname, '../commands')
    const files = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'))

    // --- CABEÇALHO: FINALIDADE DO BOT ---
    let menu = "*🤖 FIRABOT v7 - ASSISTENTE ACADÊMICO*\n"
    menu += "_Finalidade: Centralizar e facilitar o acesso a informações, links e documentos do IFMA Santa Inês._\n\n"
    
    menu += "*📋 RESUMO DE COMANDOS TÉCNICOS:*\n"
    
    menu += "*oi/menu*: Começa o atendimento sem precisar de prefixo\n"
    menu += "*!oi*: Atalho técnico compatível para abrir o menu inicial\n"

    // --- LOOP AUTOMÁTICO PARA OS OUTROS COMANDOS ---
    for (const file of files) {
      // Importa dinamicamente cada comando para ler o name e description
      const { default: cmd } = await import(`./${file}`)
      if (cmd?.adminOnly && !isAdmin) continue
      if (cmd?.name && cmd.name !== 'oi' && cmd.name !== 'help') { 
        menu += `*!${cmd.name}*: ${cmd.description}\n`
      }
    }

    // --- RODAPÉ: INSTRUÇÕES ---
    menu += "\n*💡 DICA:* Para navegar nos menus, basta digitar apenas o número da opção depois de enviar oi ou menu.\n\n"
    menu += "_Use o prefixo ! para comandos de sistema._"

    await sock.sendMessage(msg.key!.remoteJid!, { text: menu })
  }
}

export default helpCommand
