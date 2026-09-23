import type { BaileysEventMap, WASocket } from 'baileys'
import type { WhatsAppStatus } from './runtimeStatusService.js'
import { getReconnectDecision } from './connectionPolicyService.js'

type LifecycleEvent = 'BOT_STARTED' | 'BOT_CONNECTED' | 'BOT_RECONNECTING' | 'BOT_LOGGED_OUT'
interface PreparedConnection {
  createSocket: () => WASocket
  saveCreds: () => Promise<void>
}
export interface ConnectionLifecycleDependencies {
  prepare: () => Promise<PreparedConnection>
  handleMessage: (socket: WASocket, event: BaileysEventMap['messages.upsert'], context: { startedAt: number }) => Promise<void>
  setStatus: (status: WhatsAppStatus) => void
  onEvent: (event: LifecycleEvent, context?: Record<string, unknown>) => void
  onError: (message: string, error: unknown) => void
  showQr: (qr: string) => void
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** Cada socket pertence a uma geracao. Mesmo callbacks ja enfileirados ficam
 * inertes apos o descarte; apenas tarefas aceitas antes da parada sao drenadas.
 */
export function createConnectionLifecycle(
  options: { reconnectDelayMs: number; loggedOutReason: number },
  dependencies: ConnectionLifecycleDependencies
) {
  const setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = dependencies.clearTimer ?? (handle => clearTimeout(handle as NodeJS.Timeout))
  const pending = new Set<Promise<void>>()
  let active: { socket: WASocket; detach: () => void } | null = null
  let starting: Promise<void> | null = null
  let stopping: Promise<void> | null = null
  let stopped = false
  let generation = 0
  let timer: unknown | null = null
  let credsQueue = Promise.resolve()

  const cancelRetry = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  const endSocket = (socket: WASocket) => {
    try { socket.end(undefined) } catch (error) {
      dependencies.onError('Falha ao encerrar socket do WhatsApp', error)
    }
  }
  const track = (action: () => Promise<void>, message: string) => {
    const work = Promise.resolve().then(action).catch(error => {
      dependencies.onError(message, error)
    })
    pending.add(work)
    void work.then(() => pending.delete(work))
    return work
  }
  const scheduleRetry = () => {
    if (stopped || timer !== null) return
    const scheduledGeneration = generation
    timer = setTimer(() => {
      timer = null
      if (!stopped && generation === scheduledGeneration) void start()
    }, options.reconnectDelayMs)
  }

  const start = (): Promise<void> => {
    if (stopped || active) return Promise.resolve()
    if (starting) return starting
    cancelRetry()
    const ownGeneration = ++generation
    const startedAt = Math.floor((dependencies.now ?? Date.now)() / 1000)
    dependencies.setStatus('starting')
    starting = (async () => {
      try {
        const prepared = await dependencies.prepare()
        if (stopped || ownGeneration !== generation) return
        const socket = prepared.createSocket()
        const isCurrent = () => !stopped && ownGeneration === generation && active?.socket === socket
        const onConnection = (update: BaileysEventMap['connection.update']) => {
          if (!isCurrent()) return
          const { connection, qr, lastDisconnect } = update
          if (connection === 'close') {
            const decision = getReconnectDecision(lastDisconnect?.error, options.loggedOutReason)
            active!.detach()
            active = null
            generation++
            endSocket(socket)
            dependencies.setStatus(decision.runtimeStatus)
            if (!decision.shouldReconnect) {
              stopped = true
              cancelRetry()
              dependencies.onEvent('BOT_LOGGED_OUT', { reason: decision.reason })
            } else {
              dependencies.onEvent('BOT_RECONNECTING', { reason: decision.reason, reconnectDelayMs: options.reconnectDelayMs })
              scheduleRetry()
            }
            return
          }
          if (qr) dependencies.showQr(qr)
          if (connection === 'connecting') {
            dependencies.setStatus('connecting')
            dependencies.onEvent('BOT_STARTED')
          }
          if (connection === 'open') {
            cancelRetry()
            dependencies.setStatus('connected')
            dependencies.onEvent('BOT_CONNECTED')
          }
        }
        const onCreds = () => {
          if (!isCurrent()) return
          // Serializar escritas evita concorrencia nos mesmos arquivos de auth.
          const save = credsQueue.then(prepared.saveCreds)
          credsQueue = track(() => save, 'Falha ao salvar credenciais do WhatsApp')
        }
        const onMessages = (event: BaileysEventMap['messages.upsert']) => {
          if (!isCurrent()) return
          track(() => dependencies.handleMessage(socket, event, { startedAt }), 'Erro ao processar mensagem recebida')
        }
        active = {
          socket,
          detach: () => {
            socket.ev.off('connection.update', onConnection)
            socket.ev.off('creds.update', onCreds)
            socket.ev.off('messages.upsert', onMessages)
          }
        }
        socket.ev.on('connection.update', onConnection)
        socket.ev.on('creds.update', onCreds)
        socket.ev.on('messages.upsert', onMessages)
      } catch (error) {
        if (stopped || ownGeneration !== generation) return
        if (active) {
          active.detach()
          endSocket(active.socket)
          active = null
        }
        dependencies.setStatus('disconnected')
        dependencies.onError('Erro ao iniciar conexao com o WhatsApp; nova tentativa agendada', error)
        scheduleRetry()
      }
    })().finally(() => { starting = null })
    return starting
  }

  const stop = (): Promise<void> => {
    if (stopping) return stopping
    stopped = true
    generation++
    cancelRetry()
    const current = active
    current?.detach()
    active = null
    dependencies.setStatus('disconnected')
    stopping = (async () => {
      await starting
      await Promise.allSettled([...pending])
      if (current) endSocket(current.socket)
    })()
    return stopping
  }

  return { start, stop }
}

interface ShutdownDependencies {
  stopBot: () => Promise<void>
  stopFollowUps: () => Promise<void>
  closeDatabase: () => Promise<void>
  onError: (error: unknown) => void
  onTimeout: () => void
  timeoutMs?: number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** O adaptador do processo decide a saida forcada caso uma dependencia trave.
 * Em parada normal, interromper entradas e drenar trabalho precede pool.end().
 */
export function createGracefulShutdown(dependencies: ShutdownDependencies) {
  let shutdown: Promise<void> | null = null
  return () => {
    if (shutdown) return shutdown
    const setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    const clearTimer = dependencies.clearTimer ?? (handle => clearTimeout(handle as NodeJS.Timeout))
    const timer = setTimer(dependencies.onTimeout, dependencies.timeoutMs ?? 15_000)
    shutdown = (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(dependencies.stopFollowUps),
        Promise.resolve().then(dependencies.stopBot)
      ])
      const reportError = (error: unknown) => {
        try { dependencies.onError(error) } catch { /* cleanup must continue if logging also fails */ }
      }
      for (const result of results) if (result.status === 'rejected') reportError(result.reason)
      try { await dependencies.closeDatabase() } catch (error) { reportError(error) }
    })().finally(() => clearTimer(timer))
    return shutdown
  }
}
