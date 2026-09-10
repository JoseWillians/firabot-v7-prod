import type { WhatsAppStatus } from './runtimeStatusService.js'

export interface ReconnectDecision {
  reason: number | undefined
  shouldReconnect: boolean
  runtimeStatus: WhatsAppStatus
}

interface ReconnectSchedulerOptions {
  delayMs: number
  reconnect: () => Promise<void>
  onReconnectError: (error: unknown) => void
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function createReconnectScheduler(options: ReconnectSchedulerOptions) {
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as NodeJS.Timeout))
  let pendingTimer: unknown | null = null

  const schedule = () => {
    if (pendingTimer !== null) return

    pendingTimer = setTimer(() => {
      pendingTimer = null
      void options.reconnect().catch(error => {
        options.onReconnectError(error)
        schedule()
      })
    }, options.delayMs)
  }

  const cancel = () => {
    if (pendingTimer === null) return
    clearTimer(pendingTimer)
    pendingTimer = null
  }

  return {
    schedule,
    cancel,
    hasPending: () => pendingTimer !== null
  }
}

export function getDisconnectStatusCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('output' in error)) {
    return undefined
  }

  const output = (error as { output?: { statusCode?: unknown } }).output
  return typeof output?.statusCode === 'number' ? output.statusCode : undefined
}

/**
 * Mantém a regra recomendada pelo Baileys isolada de socket, timer e auth:
 * falhas transitórias tentam novamente; logout explícito exige novo pareamento.
 */
export function getReconnectDecision(error: unknown, loggedOutReason: number): ReconnectDecision {
  const reason = getDisconnectStatusCode(error)
  const shouldReconnect = reason !== loggedOutReason

  return {
    reason,
    shouldReconnect,
    runtimeStatus: shouldReconnect ? 'disconnected' : 'logged_out'
  }
}
