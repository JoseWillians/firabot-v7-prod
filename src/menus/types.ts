export type UserState =
  | 'main'
  | 'biblioteca'
  | 'docs'
  | 'docs_drca'
  | 'docs_cae'
  | 'curso'
  | 'curso_eng_comp'
  | 'curso_bach_adm'
  | 'curso_lic_fis'
  | 'curso_grad_tce'
  | 'curso_eng_civil'
  | 'links'
  | 'editais'
  | 'ru'
  | 'suporte'
  | 'suporte_confirmacao'
  | 'encerrado'

export interface MenuOption {
  key: string
  label: string
}

export interface MenuDefinition {
  title: string
  prompt: string
  options: MenuOption[]
  footer?: string
}
