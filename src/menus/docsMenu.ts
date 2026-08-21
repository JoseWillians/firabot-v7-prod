import { MenuDefinition, MenuOption } from './types.js'

export interface DocumentMenuItem extends MenuOption {
  path: string
  summary: string
}

export const fallbackDocuments: DocumentMenuItem[] = [
  {
    key: '1',
    label: 'Requerimento Acadêmico',
    path: './documentos/drca/requerimento-academico.pdf',
    summary: 'Use este requerimento para solicitar serviços acadêmicos gerais junto à DRCA, como ajustes, declarações ou outros procedimentos administrativos.'
  },
  {
    key: '2',
    label: 'Requerimento Diploma Técnico',
    path: './documentos/drca/requerimento-diploma-tecnico.pdf',
    summary: 'Use este formulário para solicitar emissão ou encaminhamento relacionado ao diploma de curso técnico.'
  },
  {
    key: '3',
    label: 'Requerimento Superior',
    path: './documentos/drca/requerimento-superior.pdf',
    summary: 'Use este requerimento para solicitações acadêmicas de cursos superiores, como aproveitamento, declarações ou demandas de registro acadêmico.'
  },
  {
    key: '4',
    label: 'Termo de Desistência',
    path: './documentos/drca/termo-de-desistencia.pdf',
    summary: 'Use este termo quando o estudante desejar formalizar a desistência do curso ou de vínculo acadêmico, conforme orientação institucional.'
  }
]

export const createDocsMenu = (documents: MenuOption[], title = '📄 *DOCUMENTOS DISPONÍVEIS*'): MenuDefinition => ({
  title,
  prompt: 'Escolha uma opção digitando o número:',
  options: documents,
  footer: '0 - Voltar ao Menu Principal'
})

export const docsCategoryMenu: MenuDefinition = {
  title: '📄 *DOCUMENTOS*',
  prompt: 'Escolha o setor dos documentos:',
  options: [
    { key: '1', label: 'Documentos DRCA' },
    { key: '2', label: 'Documentos CAE' }
  ],
  footer: '0 - Voltar ao Menu Principal'
}

export const emptyCaeDocsMenu: MenuDefinition = {
  title: '📄 *DOCUMENTOS CAE*',
  prompt: 'Ainda não há documentos da CAE cadastrados para envio automático.',
  options: [],
  footer: '0 - Voltar ao Menu Principal'
}
