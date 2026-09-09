import { config } from '../config.js'
import { getMessageJidCandidates, type WhatsAppMessageIdentity } from './userIdentityService.js'
import { getStoredPhoneE164ForJids } from '../functions/database.js'

export function normalizeAdminNumber(value: string) {
  const withoutDomain = value.split('@')[0] || value
  const withoutDevice = withoutDomain.split(':')[0] || withoutDomain
  return withoutDevice.replace(/\D/g, '')
}

export function getConfiguredAdminNumbers() {
  return config.adminNumbers
    .map(normalizeAdminNumber)
    .filter(Boolean)
}

export function hasConfiguredAdmins() {
  return getConfiguredAdminNumbers().length > 0
}

export function isAdminNumberAuthorized(jid: string, adminNumbers: string[]) {
  if (jid.endsWith('@lid')) return false
  const candidate = normalizeAdminNumber(jid)
  if (!candidate) return false

  return adminNumbers.map(normalizeAdminNumber).includes(candidate)
}

export function isAdminMessageAuthorized(message: WhatsAppMessageIdentity, adminNumbers = getConfiguredAdminNumbers()) {
  return getMessageJidCandidates(message)
    .some(jid => isAdminNumberAuthorized(jid, adminNumbers))
}

interface LidMappingCapableSocket {
  signalRepository?: {
    lidMapping?: {
      getPNForLID?: (lid: string) => Promise<string | null | undefined>
    }
  }
}

export interface AdminAuthorizationResult {
  authorized: boolean
  source: 'message' | 'lid_mapping' | 'database' | 'none'
  lidMappingAttempted: boolean
  databaseLookupAttempted: boolean
}

type StoredPhoneResolver = (jids: string[]) => Promise<string | null>

/**
 * Mensagens recentes podem chegar somente com um JID LID. Quando o PN não vem
 * nos campos alternativos, consultamos o mapeamento de identidade mantido pelo
 * próprio socket Baileys antes de negar o comando administrativo.
 */
export async function resolveAdminAuthorization(
  sock: unknown,
  message: WhatsAppMessageIdentity,
  adminNumbers = getConfiguredAdminNumbers(),
  storedPhoneResolver: StoredPhoneResolver = getStoredPhoneE164ForJids
): Promise<AdminAuthorizationResult> {
  if (isAdminMessageAuthorized(message, adminNumbers)) {
    return { authorized: true, source: 'message', lidMappingAttempted: false, databaseLookupAttempted: false }
  }

  const candidates = getMessageJidCandidates(message)
  const lidJids = candidates.filter(jid => jid.endsWith('@lid'))
  const lidMapping = (sock as LidMappingCapableSocket)?.signalRepository?.lidMapping
  const getPNForLID = lidMapping?.getPNForLID
  const canUseLidMapping = lidJids.length > 0 && typeof getPNForLID === 'function'

  if (canUseLidMapping) {
    for (const lid of lidJids) {
      try {
        const phoneJid = await getPNForLID.call(lidMapping, lid)
        if (phoneJid && isAdminNumberAuthorized(phoneJid, adminNumbers)) {
          return { authorized: true, source: 'lid_mapping', lidMappingAttempted: true, databaseLookupAttempted: false }
        }
      } catch {
        // Falha de mapeamento não libera acesso; tentamos a identidade persistida.
      }
    }
  }

  try {
    const storedPhone = await storedPhoneResolver(candidates)
    if (storedPhone && isAdminNumberAuthorized(storedPhone, adminNumbers)) {
      return {
        authorized: true,
        source: 'database',
        lidMappingAttempted: canUseLidMapping,
        databaseLookupAttempted: true
      }
    }
  } catch {
    // Falha de banco mantém a negação segura e é indicada no resultado técnico.
  }

  return {
    authorized: false,
    source: 'none',
    lidMappingAttempted: canUseLidMapping,
    databaseLookupAttempted: true
  }
}

export function isAdminJid(jid: string) {
  return isAdminNumberAuthorized(jid, getConfiguredAdminNumbers())
}
