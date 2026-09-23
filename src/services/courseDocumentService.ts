import { getPpcCategoryCodeByState } from '../menus/courseMenu.js'
import { UserState } from '../menus/types.js'
import { ActiveDocument, getAvailableDocuments } from './documentService.js'

export async function getAvailablePpcDocuments(state: UserState, listDocuments: typeof getAvailableDocuments = getAvailableDocuments): Promise<ActiveDocument[]> {
  // A ausência de PPCs ativos não autoriza reativar documentos locais.
  const categoryCode = getPpcCategoryCodeByState(state)
  if (!categoryCode) return []
  return listDocuments(categoryCode)
}

export async function findPpcDocumentByOption(state: UserState, option: string) {
  const documents = await getAvailablePpcDocuments(state)
  return documents.find(document => document.key === option)
}
