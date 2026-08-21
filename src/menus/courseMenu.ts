import { MenuDefinition, UserState } from './types.js'

export interface CourseDefinition {
  key: string
  label: string
  state: UserState
  menuTitle: string
  categoryCode: string
}

export interface PpcDocumentDefinition {
  key: string
  label: string
  path: string
  summary: string
}

export const courses: CourseDefinition[] = [
  {
    key: '1',
    label: 'Engenharia de Computação',
    state: 'curso_eng_comp',
    menuTitle: '🎓 *Engenharia de Computação - IFMA*',
    categoryCode: 'ppc_eng_comp'
  },
  {
    key: '2',
    label: 'Bacharelado em Administração',
    state: 'curso_bach_adm',
    menuTitle: '🎓 *Bacharelado em Administração - IFMA*',
    categoryCode: 'ppc_bach_adm'
  },
  {
    key: '3',
    label: 'Licenciatura em Física',
    state: 'curso_lic_fis',
    menuTitle: '🎓 *Licenciatura em Física - IFMA*',
    categoryCode: 'ppc_lic_fis'
  },
  {
    key: '4',
    label: 'Tecnologia em Construção de Edifícios',
    state: 'curso_grad_tce',
    menuTitle: '🎓 *Tecnologia em Construção de Edifícios - IFMA*',
    categoryCode: 'ppc_grad_tce'
  },
  {
    key: '5',
    label: 'Engenharia Civil',
    state: 'curso_eng_civil',
    menuTitle: '🎓 *Engenharia Civil - IFMA*',
    categoryCode: 'ppc_eng_civil'
  }
]

export const ppcDocumentsByCourseState: Partial<Record<UserState, PpcDocumentDefinition[]>> = {
  curso_eng_comp: [
    {
      key: '1',
      label: 'PPC - Engenharia de Computação 2022',
      path: './documentos/ppc/eng_comp/ppc.eng_.comp_2022_.pdf',
      summary: 'Este PPC apresenta a organização curricular, carga horária, perfil do egresso e regras acadêmicas do curso de Engenharia de Computação para as turmas vinculadas a essa matriz.'
    },
    {
      key: '2',
      label: 'PPC - Engenharia de Computação 2024',
      path: './documentos/ppc/eng_comp/ppc.eng_.comp_2024_.pdf',
      summary: 'Este PPC descreve a matriz mais recente de Engenharia de Computação, com componentes curriculares, objetivos do curso e orientações acadêmicas para as turmas da nova estrutura.'
    }
  ],
  curso_bach_adm: [
    {
      key: '1',
      label: 'PPC - Bacharelado em Administração 2022',
      path: './documentos/ppc/bach_adm/ppc_adm_2022.pdf',
      summary: 'Este PPC reúne as diretrizes do curso de Administração, incluindo matriz curricular, competências esperadas, carga horária e normas do percurso formativo.'
    },
    {
      key: '2',
      label: 'PPC - Bacharelado em Administração 2023',
      path: './documentos/ppc/bach_adm/ppc_adm_2023.pdf',
      summary: 'Este PPC apresenta a atualização do curso de Administração, servindo como referência para disciplinas, perfil profissional e organização acadêmica da matriz vigente.'
    }
  ],
  curso_lic_fis: [
    {
      key: '1',
      label: 'PPC - Licenciatura em Física 2019',
      path: './documentos/ppc/lic_fis/ppc_fis_2019.pdf',
      summary: 'Este PPC orienta a formação do licenciando em Física, detalhando disciplinas, estágios, práticas pedagógicas e requisitos da matriz de 2019.'
    },
    {
      key: '2',
      label: 'PPC - Licenciatura em Física 2023',
      path: './documentos/ppc/lic_fis/ppc_fis_2023.pdf',
      summary: 'Este PPC apresenta a matriz atualizada da Licenciatura em Física, com foco na formação docente, componentes curriculares e atividades acadêmicas obrigatórias.'
    }
  ],
  curso_grad_tce: [
    {
      key: '1',
      label: 'PPC - Tecnologia em Construção de Edifícios',
      path: './documentos/ppc/grad_tce/ppc_tce.pdf',
      summary: 'Este PPC descreve a estrutura do curso de Tecnologia em Construção de Edifícios, incluindo matriz curricular, competências profissionais e orientações para integralização.'
    }
  ],
  curso_eng_civil: [
    {
      key: '1',
      label: 'PPC - Engenharia Civil 2022',
      path: './documentos/ppc/eng_civil/ppc_eng_civil_2022.pdf',
      summary: 'Este PPC apresenta a organização acadêmica de Engenharia Civil, com matriz curricular, perfil do egresso, carga horária e requisitos do curso.'
    }
  ]
}

export const courseMenu: MenuDefinition = {
  title: '🎓 *PPC DO CURSO*',
  prompt: 'Escolha o curso:',
  options: courses.map(({ key, label }) => ({ key, label })),
  footer: '0 - Voltar ao Menu Principal'
}

export function createPpcMenu(course: CourseDefinition, documents: PpcDocumentDefinition[]): MenuDefinition {
  return {
    title: course.menuTitle,
    prompt: 'Escolha o PPC disponível:',
    options: documents.map(({ key, label }) => ({ key, label })),
    footer: '0 - Voltar ao Menu Principal'
  }
}

export const engineeringComputerPpcMenu: MenuDefinition = createPpcMenu(courses[0], ppcDocumentsByCourseState.curso_eng_comp || [])

export function findCourseByOption(option: string) {
  return courses.find(course => course.key === option)
}

export function findCourseByState(state: UserState) {
  return courses.find(course => course.state === state)
}

export function getPpcCategoryCodeByState(state: UserState) {
  return findCourseByState(state)?.categoryCode
}

export function getPpcDocumentsByState(state: UserState) {
  return ppcDocumentsByCourseState[state] || []
}

export function findPpcDocumentByOption(state: UserState, option: string) {
  return getPpcDocumentsByState(state).find(document => document.key === option)
}

export function formatPpcMenuDefinition(state: UserState): MenuDefinition | undefined {
  const course = findCourseByState(state)
  if (!course) return undefined

  return createPpcMenu(course, getPpcDocumentsByState(state))
}
