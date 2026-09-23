import type { WASocket } from 'baileys'
import { createDocsMenu } from '../menus/docsMenu.js'
import { ActiveDocument, DocumentCatalogUnavailableError } from '../services/documentService.js'
import { formatMenu } from '../services/menuService.js'

/** Retorna null somente quando a consulta falha; [] é um catálogo válido vazio. */
export async function loadDocumentCatalog(sock: WASocket, jid: string, load: () => Promise<ActiveDocument[]>): Promise<ActiveDocument[] | null> {
  try {
    return await load()
  } catch (error) {
    if (!(error instanceof DocumentCatalogUnavailableError)) throw error
    await sock.sendMessage(jid, {
      text: 'O catálogo de documentos está temporariamente indisponível. Tente novamente em alguns instantes ou envie menu para voltar ao início.\n\nCódigo de referência: 503.'
    })
    return null
  }
}

export function formatDocumentCatalog(documents: ActiveDocument[], title?: string) {
  const menu = createDocsMenu(documents, title)
  if (!documents.length) menu.prompt = 'Ainda não há documentos cadastrados para envio automático nesta categoria.'
  return formatMenu(menu)
}
