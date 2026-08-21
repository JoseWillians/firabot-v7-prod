import { getPpcCategoryCodeByState, getPpcDocumentsByState } from '../menus/courseMenu.js'
import { UserState } from '../menus/types.js'
import { ActiveDocument, getAvailableDocuments } from './documentService.js'

function mapFallbackPpcs(state: UserState): ActiveDocument[] {
  return getPpcDocumentsByState(state).map(document => ({
    key: document.key,
    label: document.label,
    path: document.path,
    summary: document.summary
  }))
}

export async function getAvailablePpcDocuments(state: UserState): Promise<ActiveDocument[]> {
  /**
   * PPCs já podem vir da tabela docs por category_code. Enquanto o painel e o
   * cadastro dinâmico não existem, mantemos fallback local para não quebrar o
   * fluxo dos PDFs que já estão no repositório.
   */
  const categoryCode = getPpcCategoryCodeByState(state)
  if (!categoryCode) return mapFallbackPpcs(state)

  const databaseDocuments = await getAvailableDocuments(categoryCode)
  return databaseDocuments.length ? databaseDocuments : mapFallbackPpcs(state)
}

export async function findPpcDocumentByOption(state: UserState, option: string) {
  const documents = await getAvailablePpcDocuments(state)
  return documents.find(document => document.key === option)
}
