import { MenuDefinition } from './types.js'

export const mainMenu: MenuDefinition = {
  title: '🤖 *ASSISTENTE IFMA*',
  prompt: 'Escolha uma opção digitando o número:',
  options: [
    { key: '1', label: 'Biblioteca' },
    { key: '2', label: 'Documentos' },
    { key: '3', label: 'PPC do Curso' },
    { key: '4', label: 'Links Importantes' },
    { key: '5', label: 'Editais Abertos' },
    { key: '6', label: 'RU' },
    { key: '7', label: 'Suporte' }
  ],
  footer: '_Comandos: !ping, !help_'
}
