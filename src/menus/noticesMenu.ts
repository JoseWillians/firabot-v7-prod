import { getActiveNotices } from '../functions/database.js'
import { errorLog } from '../services/logService.js'

export interface OpenNotice {
  title: string
  url: string
  status: 'inscricoes_abertas' | 'em_andamento'
}

export const openNotices: OpenNotice[] = [
  {
    title: 'Edital Nº 143/2026 - Seletivo de Professor Substituto - Campus Santa Inês',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/148/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 107/2026-PRPGI/IFMA - Pós-Graduação Stricto Sensu em Química (PPGQ) em Nível de Mestrado 2026.2',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/150/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 105/2026 - Seletivo de Professor Substituto - Campus Grajaú',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/156/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 99/2026 - Seletivo de Professor Substituto - Campus Monte Castelo',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/153/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 80/2026 - Seletivo de Professor Substituto - Campus Timon',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/149/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 74/2026 - Campus Centro Histórico - Pós-graduação Lato Sensu em Arte, Mídia e Educação',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/157/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 71/2026 - Seletivo de Professor Substituto - Campus Pinheiro',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/151/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 45/2026-PRPGI/IFMA - Programa de Pós-Graduação Doutorado em Química (PDQ)',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/155/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 45/2026 - Seletivo de Professor Substituto - Campus Pinheiro',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/143/',
    status: 'em_andamento'
  },
  {
    title: 'Edital Nº 30/2026 - Seletivo Unificado EAD 2026 - Cursos Técnicos Subsequentes EAD',
    url: 'https://processoseletivo.ifma.edu.br/edital/visualizar/147/',
    status: 'em_andamento'
  }
]

export async function formatOpenNoticesMessage(options: { useDatabase?: boolean } = {}) {
  let notices: OpenNotice[] = []

  if (options.useDatabase !== false) {
    try {
      const databaseNotices = await getActiveNotices()
      notices = databaseNotices.map(notice => ({
        title: notice.title,
        url: notice.url || '',
        status: notice.status.toLowerCase().includes('inscri') ? 'inscricoes_abertas' : 'em_andamento'
      }))
    } catch (error) {
      errorLog('DATABASE_ERROR', 'Erro ao carregar editais dinâmicos. Usando fallback local', error)
    }
  }

  if (!notices.length) notices = openNotices.slice(0, 10)

  const noticesText = notices
    .map((notice, index) => {
      const status = notice.status === 'inscricoes_abertas' ? 'Inscrições abertas' : 'Em andamento'
      return notice.url
        ? `${index + 1}. ${notice.title}\n   ${status}: ${notice.url}`
        : `${index + 1}. ${notice.title}\n   ${status}`
    })
    .join('\n\n')

  return `📢 *Editais IFMA*\n\n` +
         `Consulte os editais encontrados na página oficial de processos seletivos do IFMA:\n\n` +
         `${noticesText}\n\n` +
         `Fonte: https://processoseletivo.ifma.edu.br/`
}
