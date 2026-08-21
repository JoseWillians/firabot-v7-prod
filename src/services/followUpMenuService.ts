import { MenuOption } from '../menus/types.js'

const mainMenuReturnOption = '0 - Voltar ao Menu Principal'
const endConversationOption = 'encerrar - Terminar conversa'

export function getRemainingMenuOptions(options: MenuOption[], selectedOption: string): MenuOption[] {
  return options.filter(option => option.key !== selectedOption)
}

export function formatFollowUpOptions(options: MenuOption[], selectedOption: string): string {
  return [
    ...getRemainingMenuOptions(options, selectedOption).map(option => `${option.key} - ${option.label}`),
    mainMenuReturnOption,
    endConversationOption
  ].join('\n')
}

export function formatContextualFollowUpMessage(options: MenuOption[], selectedOption: string): string {
  return `🤖 *ASSISTENTE IFMA*\n\n` +
         `Deseja consultar outro item deste menu?\n\n` +
         `${formatFollowUpOptions(options, selectedOption)}`
}
