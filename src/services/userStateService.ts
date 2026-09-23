import { getUserStateRecord, setUserState } from '../functions/database.js'
import { config } from '../config.js'
import { UserState } from '../menus/types.js'
import { botLog, debugLog, errorLog } from './logService.js'

const allowedStates = new Set<UserState>([
  'main',
  'biblioteca',
  'docs',
  'docs_drca',
  'docs_cae',
  'curso',
  'curso_eng_comp',
  'curso_bach_adm',
  'curso_lic_fis',
  'curso_grad_tce',
  'curso_eng_civil',
  'links',
  'editais',
  'ru',
  'suporte',
  'suporte_confirmacao',
  'encerrado'
])
interface MemoryStateRecord {
  state: UserState
  updatedAt: Date
  pending?: boolean
  requiresMenuConfirmation?: boolean
}

export interface UserStateLookupResult {
  state: UserState
  source: 'database' | 'memory' | 'default'
  databaseAvailable: boolean
  requiresMenuConfirmation?: boolean
}

const memoryStates = new Map<string, MemoryStateRecord>()
const maxMemoryStates = 1000
function rememberState(jid: string, record: MemoryStateRecord) {
  memoryStates.delete(jid)
  for (const [key, value] of memoryStates) {
    if (isUserStateExpired(value.updatedAt)) memoryStates.delete(key)
  }
  if (memoryStates.size >= maxMemoryStates) memoryStates.delete(memoryStates.keys().next().value!)
  memoryStates.set(jid, record)
}
const stateDependencies = { getUserStateRecord, setUserState, botLog, debugLog, errorLog }

/**
 * Restringe estados aceitos pelo roteador de menus.
 * Se o banco tiver um valor inesperado, o bot volta para main em vez de
 * interpretar números em um fluxo desconhecido.
 */
export function normalizeUserState(state: string | null | undefined): UserState {
  return allowedStates.has(state as UserState) ? state as UserState : 'main'
}

export function isStateExpiredWithTtl(updatedAt: Date | null | undefined, ttlMinutes: number, now = new Date()) {
  if (!updatedAt || ttlMinutes <= 0) return false

  const ageMs = now.getTime() - updatedAt.getTime()
  return ageMs > ttlMinutes * 60 * 1000
}

export function isUserStateExpired(updatedAt: Date | null | undefined, now = new Date()) {
  return isStateExpiredWithTtl(updatedAt, config.userStateTtlMinutes, now)
}

/**
 * Busca o estado no banco e mantém um cache em memória como fallback explícito.
 * O fallback não é silencioso: o erro é logado, porque perder estado no banco
 * pode fazer uma opção de submenu ser interpretada como menu principal.
 */
export function canSafelyRouteNumericInput(result: UserStateLookupResult) {
  return !result.requiresMenuConfirmation && (result.databaseAvailable || result.source === 'memory')
}

export async function getCurrentUserStateResult(phoneNumber: string, overrides: Partial<typeof stateDependencies> = {}): Promise<UserStateLookupResult> {
  const dependencies = { ...stateDependencies, ...overrides }
  try {
    // Reconciliar primeiro: o banco recuperado pode conter um menu anterior.
    // A identidade do registro evita limpar uma transicao concorrente mais nova.
    const pending = memoryStates.get(phoneNumber)
    if (pending?.pending) {
      if (isUserStateExpired(pending.updatedAt)) {
        await updateUserState(phoneNumber, 'main', dependencies)
        const reset = memoryStates.get(phoneNumber)!
        return { state: reset.state, source: reset.pending ? 'memory' : 'database', databaseAvailable: !reset.pending }
      }
      await dependencies.setUserState(phoneNumber, pending.state)
      if (memoryStates.get(phoneNumber) === pending) pending.pending = false
      const latest = memoryStates.get(phoneNumber)!
      return { state: latest.state, source: latest.pending ? 'memory' : 'database', databaseAvailable: !latest.pending }
    }
    const record = await dependencies.getUserStateRecord(phoneNumber)
    // Sem contexto confirmado neste processo, o banco pode conter uma transição
    // anterior à queda. Consumir a primeira escolha sem interpretá-la.
    if (!pending || pending.requiresMenuConfirmation) {
      rememberState(phoneNumber, { state: 'main', updatedAt: new Date(), requiresMenuConfirmation: true })
      return { state: 'main', source: 'database', databaseAvailable: true, requiresMenuConfirmation: true }
    }
    const state = normalizeUserState(record.state)

    if (isUserStateExpired(record.updatedAt)) {
      const reset: MemoryStateRecord = { state: 'main', updatedAt: new Date(), pending: true }
      rememberState(phoneNumber, reset)
      await dependencies.setUserState(phoneNumber, 'main')
      reset.pending = false
      dependencies.botLog('USER_STATE_READ', 'Estado expirado por TTL; usuário voltou para main', {
        user: phoneNumber,
        stateBefore: state,
        stateAfter: 'main',
        ttlMinutes: config.userStateTtlMinutes
      })
      return { state: 'main', source: 'database', databaseAvailable: true }
    }

    rememberState(phoneNumber, { state, updatedAt: record.updatedAt || new Date() })
    dependencies.debugLog('Estado do usuário carregado', {
      eventType: 'USER_STATE_READ',
      user: phoneNumber,
      stateAfter: state,
      source: 'database',
      resultCode: 200
    })
    return { state, source: 'database', databaseAvailable: true }
  } catch (error) {
    const fallback = memoryStates.get(phoneNumber)
    const fallbackState = fallback && !isUserStateExpired(fallback.updatedAt) ? fallback.state : undefined
    dependencies.errorLog('DATABASE_ERROR', 'Erro ao buscar ou reconciliar estado do usuário no banco', error, {
      user: phoneNumber,
      fallback: fallbackState || 'main'
    })
    return fallbackState
      ? { state: fallbackState, source: 'memory', databaseAvailable: false, ...(fallback?.requiresMenuConfirmation ? { requiresMenuConfirmation: true } : {}) }
      : { state: 'main', source: 'default', databaseAvailable: false }
  }
}

export async function getCurrentUserState(phoneNumber: string): Promise<UserState> {
  return (await getCurrentUserStateResult(phoneNumber)).state
}

export async function updateUserState(phoneNumber: string, state: UserState, overrides: Partial<typeof stateDependencies> = {}): Promise<UserState> {
  const dependencies = { ...stateDependencies, ...overrides }
  const record: MemoryStateRecord = { state, updatedAt: new Date(), pending: true }
  rememberState(phoneNumber, record)

  try {
    await dependencies.setUserState(phoneNumber, state)
    if (memoryStates.get(phoneNumber) === record) record.pending = false
  } catch (error) {
    dependencies.errorLog('DATABASE_ERROR', 'Erro ao salvar estado do usuário no banco; sincronizacao pendente', error, { user: phoneNumber, state })
  }

  return state
}
