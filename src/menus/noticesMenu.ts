import { getActiveNotices } from '../functions/database.js'
import {
  IFMA_ALL_NOTICES_URL,
  getCachedSantaInesNotices,
  isNoticesSyncFresh,
  syncSantaInesNotices
} from '../services/ifmaNoticesSyncService.js'
import { errorLog } from '../services/logService.js'

export interface OpenNotice {
  title: string
  url: string
  status: 'inscricoes_abertas' | 'em_andamento'
}

export const openNotices: OpenNotice[] = [
  {
    title: 'Edital N°321/2026 - SELEÇÃO SIMPLIFICADA PARA CONTRATAÇÃO TEMPORÁRIA DE PROFESSOR REGENTE',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21293',
    status: 'em_andamento'
  },
  {
    title: 'Edital N°219/2026 - SELEÇÃO SIMPLIFICADA PARA CONTRATAÇÃO TEMPORÁRIA DE PROFESSOR REGENTE',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=20965',
    status: 'em_andamento'
  },
  {
    title: 'Edital N° 171/2026 SELEÇÃO NOS PROGRAMAS DE ASSISTÊNCIA ESTUDANTIL (PAE) - 2026 - Campus Santa Inês',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=20794',
    status: 'em_andamento'
  },
  {
    title: 'Edital N° 319/2026- SELEÇÃO PARA PROFISSIONAL EXTERNO ATUAR COMO PROFESSOR NO CURSO AQUICULTOR',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21271',
    status: 'em_andamento'
  },
  {
    title: 'Edital N° 97/2026- PROCESSO SELETIVO PARA CONTRATAÇÃO DE BOLSISTAS DE APOIO À INCLUSÃO',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=20591',
    status: 'em_andamento'
  },
  {
    title: 'Edital N° 268/2026 - CHAMADA PÚBLICA PARA ACESSO AO CURSO AQUICULTOR',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21033',
    status: 'em_andamento'
  },
  {
    title: 'Edital N° 261/2026 - CHAMADA PÚBLICA PARA ACESSO AO CURSO DE INSTALADOR DE SISTEMAS FOTOVOLTAICOS',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21020',
    status: 'em_andamento'
  },
  {
    title: 'Edital N° 278/2025 - SELEÇÃO PARA PROFISSIONAL EXTERNO ATUAR COMO PROFESSOR NO CURSO AQUICULTOR',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=19914',
    status: 'em_andamento'
  },
  {
    title: 'EDITAL N° 272/2025 - PROCESSO SELETIVO DE PROFISSIONAIS EXTERNOS Mulheres Mil- Vitorino Freire',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=19902',
    status: 'em_andamento'
  },
  {
    title: 'EDITAL N° 271/2025 - PROCESSO SELETIVO DE PROFISSIONAIS INTERNOS Mulheres Mil- Vitorino Freire',
    url: 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=19901',
    status: 'em_andamento'
  }
]

export class NoticesUnavailableError extends Error {
  constructor() {
    super('Editais temporariamente indisponíveis')
    this.name = 'NoticesUnavailableError'
  }
}

function isLegacySeedOnly(notices: Array<{ url?: string | null }>): boolean {
  return notices.length === 1 && notices[0].url === 'https://processoseletivo.ifma.edu.br/'
}

export async function formatOpenNoticesMessage(
  options: {
    useDatabase?: boolean
    listNotices?: typeof getActiveNotices
    syncNotices?: typeof syncSantaInesNotices
  } = {}
) {
  let notices: OpenNotice[]

  if (options.useDatabase !== false) {
    const queryNotices = options.listNotices ?? getActiveNotices
    const syncFn = options.syncNotices ?? syncSantaInesNotices
    const allowAutoSync = !options.listNotices || Boolean(options.syncNotices)

    if (allowAutoSync && !isNoticesSyncFresh()) {
      try {
        await syncFn()
      } catch {
        // Se o portal do IFMA oscilar no momento da consulta, prossegue com o banco/cache.
      }
    }

    try {
      let databaseNotices = await queryNotices({ throwOnError: true })
      if (allowAutoSync && (databaseNotices.length === 0 || isLegacySeedOnly(databaseNotices))) {
        try {
          await syncFn({ force: true })
          databaseNotices = await queryNotices({ throwOnError: true })
        } catch {
          // Mantém o que estiver disponível no banco ou cache se o portal falhar.
        }
      }

      if (allowAutoSync && (databaseNotices.length === 0 || isLegacySeedOnly(databaseNotices))) {
        const cached = getCachedSantaInesNotices()
        notices =
          cached.length > 0
            ? cached.slice(0, 10)
            : databaseNotices.slice(0, 10).map((notice) => ({
                title: notice.title,
                url: notice.url || '',
                status: notice.status.toLowerCase().includes('inscri') ? 'inscricoes_abertas' : 'em_andamento'
              }))
      } else {
        notices = databaseNotices.slice(0, 10).map((notice) => ({
          title: notice.title,
          url: notice.url || '',
          status: notice.status.toLowerCase().includes('inscri') ? 'inscricoes_abertas' : 'em_andamento'
        }))
      }
    } catch {
      const cached = allowAutoSync ? getCachedSantaInesNotices() : []
      if (cached.length > 0) {
        notices = cached.slice(0, 10)
      } else {
        errorLog('DATABASE_ERROR', 'Erro ao carregar editais ativos', new Error('Consulta de editais indisponível'), {
          resultCode: 503
        })
        throw new NoticesUnavailableError()
      }
    }
  } else {
    notices = openNotices.slice(0, 10)
  }

  const noticesText = notices
    .slice(0, 10)
    .map((notice, index) => {
      const status = notice.status === 'inscricoes_abertas' ? 'Inscrições abertas' : 'Em andamento'
      return notice.url
        ? `${index + 1}. ${notice.title}\n   ${status}: ${notice.url}`
        : `${index + 1}. ${notice.title}\n   ${status}`
    })
    .join('\n\n')

  const summary = noticesText || 'Não há editais ativos cadastrados no momento.'
  return (
    `📢 *Editais IFMA - Campus Santa Inês*\n` +
    `_(10 últimos editais atualizados)_\n\n` +
    `${summary}\n\n` +
    `🌐 *Todos os editais da rede IFMA:*\n` +
    `Fonte: ${IFMA_ALL_NOTICES_URL}`
  )
}
