import type { ActiveDocument } from './documentService.js'
import type { UserState } from '../menus/types.js'

const snapshots = new Map<string, { documents: ActiveDocument[]; expiresAt: number }>()
const keyFor = (jid: string, state: UserState) => `${jid}:${state}`

/** Guarda exatamente a numeracao exibida; uma lista nova exige nova escolha.
 * TTL e limite evitam reter indefinidamente conversas que nao voltaram ao bot.
 */
export function rememberDocumentMenu(jid: string, state: UserState, documents: ActiveDocument[], now = Date.now()) {
  for (const [key, value] of snapshots) if (value.expiresAt <= now) snapshots.delete(key)
  const key = keyFor(jid, state)
  snapshots.delete(key)
  if (snapshots.size >= 1000) snapshots.delete(snapshots.keys().next().value!)
  snapshots.set(key, { documents: documents.map(document => ({ ...document })), expiresAt: now + 30 * 60 * 1000 })
}

export function isDocumentMenuCurrent(jid: string, state: UserState, documents: ActiveDocument[], now = Date.now()) {
  const snapshot = snapshots.get(keyFor(jid, state))
  if (!snapshot || snapshot.expiresAt <= now) return false
  return snapshot.documents.length === documents.length && snapshot.documents.every((item, index) => {
    const current = documents[index]!
    return item.key === current.key && item.label === current.label && item.path === current.path
  })
}
