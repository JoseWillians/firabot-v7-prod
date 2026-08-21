import { MenuDefinition, UserState } from '../menus/types.js'
import { mainMenu } from '../menus/mainMenu.js'
import { courseMenu, engineeringComputerPpcMenu, formatPpcMenuDefinition } from '../menus/courseMenu.js'

/**
 * Renderiza menus declarativos em texto de WhatsApp.
 * Manter a formatação aqui evita repetir strings grandes no handler e facilita
 * trocar labels/opções sem mexer na lógica de navegação.
 */
export function formatMenu(menu: MenuDefinition): string {
  const options = menu.options.map(option => `${option.key} - ${option.label}`).join('\n')
  return `${menu.title}\n\n${menu.prompt}\n\n${options}${menu.footer ? `\n\n${menu.footer}` : ''}`
}

export function formatMainMenu() {
  return formatMenu(mainMenu)
}

export function formatCourseMenu() {
  return formatMenu(courseMenu)
}

export function formatEngineeringComputerPpcMenu() {
  return formatMenu(engineeringComputerPpcMenu)
}

export function formatPpcMenuByState(state: UserState) {
  const menu = formatPpcMenuDefinition(state)
  return menu ? formatMenu(menu) : undefined
}

export function getMenuNameByState(state: UserState) {
  const names: Record<UserState, string> = {
    main: 'menu principal',
    biblioteca: 'menu da biblioteca',
    docs: 'menu de documentos',
    docs_drca: 'menu de documentos DRCA',
    docs_cae: 'menu de documentos CAE',
    curso: 'menu de curso',
    curso_eng_comp: 'menu de PPC de Engenharia de Computação',
    curso_bach_adm: 'menu de PPC de Administração',
    curso_lic_fis: 'menu de PPC de Licenciatura em Física',
    curso_grad_tce: 'menu de PPC de Tecnologia em Construção de Edifícios',
    curso_eng_civil: 'menu de PPC de Engenharia Civil',
    links: 'menu de links importantes',
    editais: 'menu de editais abertos',
    ru: 'menu do RU',
    suporte: 'fluxo de suporte',
    suporte_confirmacao: 'confirmação de suporte',
    encerrado: 'atendimento encerrado'
  }

  return names[state]
}

export function isNumericOption(text: string) {
  return /^[0-9]+$/.test(text)
}
