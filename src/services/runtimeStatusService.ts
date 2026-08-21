export type WhatsAppStatus = 'starting' | 'connecting' | 'connected' | 'disconnected' | 'logged_out'
export type DatabaseStatus = 'unknown' | 'connected' | 'unavailable'

interface RuntimeStatus {
  startedAt: Date
  whatsapp: WhatsAppStatus
  database: DatabaseStatus
}

const runtimeStatus: RuntimeStatus = {
  startedAt: new Date(),
  whatsapp: 'starting',
  database: 'unknown'
}

/**
 * Guarda estado operacional em memória para comandos como !status.
 * Esse serviço não substitui logs persistentes; ele só resume o estado atual
 * do processo em execução.
 */
export function setRuntimeStartedAt(date = new Date()) {
  runtimeStatus.startedAt = date
}

export function setWhatsAppStatus(status: WhatsAppStatus) {
  runtimeStatus.whatsapp = status
}

export function setDatabaseStatus(status: DatabaseStatus) {
  runtimeStatus.database = status
}

export function getRuntimeStatus() {
  return { ...runtimeStatus }
}
