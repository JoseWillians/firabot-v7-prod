import { UserState } from '../menus/types.js'

export type MenuRoute =
  | 'main'
  | 'docs'
  | 'docs_drca'
  | 'docs_cae'
  | 'curso'
  | 'curso_eng_comp'
  | 'curso_bach_adm'
  | 'curso_lic_fis'
  | 'curso_grad_tce'
  | 'curso_eng_civil'

/**
 * Garante que uma opção numérica seja interpretada pelo menu correto.
 * Essa regra protege o caso crítico: após abrir "Documentos", a opção "3"
 * deve continuar no submenu docs, e não cair no "PPC do Curso" do menu main.
 */
export function getMenuRouteForOption(currentState: UserState, option: string): MenuRoute {
  if (option === '0') return 'main'
  if (currentState === 'docs') return 'docs'
  if (currentState === 'docs_drca') return 'docs_drca'
  if (currentState === 'docs_cae') return 'docs_cae'
  if (currentState === 'curso') return 'curso'
  if (currentState === 'curso_eng_comp') return 'curso_eng_comp'
  if (currentState === 'curso_bach_adm') return 'curso_bach_adm'
  if (currentState === 'curso_lic_fis') return 'curso_lic_fis'
  if (currentState === 'curso_grad_tce') return 'curso_grad_tce'
  if (currentState === 'curso_eng_civil') return 'curso_eng_civil'
  return 'main'
}

export function shouldCaptureSupportMessage(currentState: UserState, text: string) {
  /**
   * No suporte, mensagens numéricas podem ser matrícula, protocolo ou telefone.
   * Só deixamos o "0" seguir para o roteador numérico porque ele é o comando
   * explícito de voltar ao menu principal.
   */
  return currentState === 'suporte' && text.trim() !== '0'
}
