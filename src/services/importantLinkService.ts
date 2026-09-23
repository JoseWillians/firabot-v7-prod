import { getActiveImportantLinks } from '../functions/database.js'
import { errorLog } from './logService.js'

interface ImportantLink {
  title: string
  url: string
}

const fallbackImportantLinks: ImportantLink[] = [
  { title: 'SUAP IFMA', url: 'https://suap.ifma.edu.br/accounts/login/?next=/' },
  { title: 'Campus Santa Inês', url: 'https://santaines.ifma.edu.br/' }
]

/**
 * Links ativos no banco são a fonte autoritativa. A lista local só pode ser
 * solicitada explicitamente por testes ou ferramentas de desenvolvimento.
 */
export class ImportantLinksUnavailableError extends Error {
  constructor() {
    super('Links importantes temporariamente indisponíveis')
    this.name = 'ImportantLinksUnavailableError'
  }
}

export async function formatImportantLinksMessage(options: {
  useDatabase?: boolean
  listLinks?: typeof getActiveImportantLinks
} = {}) {
  let links: ImportantLink[]

  if (options.useDatabase === false) {
    links = fallbackImportantLinks
  } else {
    try {
      const databaseLinks = await (options.listLinks ?? getActiveImportantLinks)({ throwOnError: true })
      links = databaseLinks.map(link => ({ title: link.title, url: link.url }))
    } catch {
      errorLog('DATABASE_ERROR', 'Erro ao carregar links importantes ativos', new Error('Consulta de links indisponível'), { resultCode: 503 })
      throw new ImportantLinksUnavailableError()
    }
  }

  const linksText = links
    .map((link, index) => `${index + 1}. ${link.title}\n   ${link.url}`)
    .join('\n\n')

  return `🔗 *Links Importantes*\n\n${linksText || 'Não há links ativos cadastrados no momento.'}`
}
