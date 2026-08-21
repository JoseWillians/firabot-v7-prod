import { config } from '../config.js'

export function normalizeAdminNumber(value: string) {
  const withoutDomain = value.split('@')[0] || value
  return withoutDomain.replace(/\D/g, '')
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
  const candidate = normalizeAdminNumber(jid)
  if (!candidate) return false

  return adminNumbers.map(normalizeAdminNumber).includes(candidate)
}

export function isAdminJid(jid: string) {
  return isAdminNumberAuthorized(jid, getConfiguredAdminNumbers())
}
