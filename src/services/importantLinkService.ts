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
 * Links importantes são conteúdo de atendimento, então o painel é a fonte
 * preferencial. O fallback local mantém o menu útil quando o banco está vazio
 * ou indisponível durante desenvolvimento.
 */
export async function formatImportantLinksMessage() {
  let links: ImportantLink[] = []

  try {
    const databaseLinks = await getActiveImportantLinks()
    links = databaseLinks.map(link => ({
      title: link.title,
      url: link.url
    }))
  } catch (error) {
    errorLog('DATABASE_ERROR', 'Erro ao carregar links importantes dinâmicos. Usando fallback local', error)
  }

  if (!links.length) links = fallbackImportantLinks

  const linksText = links
    .map((link, index) => `${index + 1}. ${link.title}\n   ${link.url}`)
    .join('\n\n')

  return `🔗 *Links Importantes*\n\n${linksText}`
}
