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
}

export interface UserStateLookupResult {
  state: UserState
  source: 'database' | 'memory' | 'default'
  databaseAvailable: boolean
}

const memoryStates = new Map<string, MemoryStateRecord>()

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
  return result.databaseAvailable || result.source === 'memory'
}

export async function getCurrentUserStateResult(phoneNumber: string): Promise<UserStateLookupResult> {
  try {
    const record = await getUserStateRecord(phoneNumber)
    const state = normalizeUserState(record.state)

    if (isUserStateExpired(record.updatedAt)) {
      memoryStates.set(phoneNumber, { state: 'main', updatedAt: new Date() })
      await setUserState(phoneNumber, 'main')
      botLog('USER_STATE_READ', 'Estado expirado por TTL; usuário voltou para main', {
        user: phoneNumber,
        stateBefore: state,
        stateAfter: 'main',
        ttlMinutes: config.userStateTtlMinutes
      })
      return { state: 'main', source: 'database', databaseAvailable: true }
    }

    memoryStates.set(phoneNumber, { state, updatedAt: record.updatedAt || new Date() })
    debugLog('Estado do usuário carregado', {
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
    errorLog('DATABASE_ERROR', 'Erro ao buscar estado do usuário no banco', error, {
      user: phoneNumber,
      fallback: fallbackState || 'main'
    })
    return fallbackState
      ? { state: fallbackState, source: 'memory', databaseAvailable: false }
      : { state: 'main', source: 'default', databaseAvailable: false }
  }
}

export async function getCurrentUserState(phoneNumber: string): Promise<UserState> {
  return (await getCurrentUserStateResult(phoneNumber)).state
}

export async function updateUserState(phoneNumber: string, state: UserState): Promise<UserState> {
  memoryStates.set(phoneNumber, { state, updatedAt: new Date() })

  try {
    await setUserState(phoneNumber, state)
  } catch (error) {
    errorLog('DATABASE_ERROR', 'Erro ao salvar estado do usuário no banco', error, { user: phoneNumber, state })
  }

  return state
}
