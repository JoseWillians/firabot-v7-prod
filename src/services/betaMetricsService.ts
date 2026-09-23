/**
 * Agregacao local e sem identificadores para eventos tecnicos em JSONL.
 * Somente campos explicitamente permitidos entram no relatorio.
 */
export const betaMetricsMaxLineBytes = 64 * 1024

const stateNames = [
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
] as const

type KnownState = typeof stateNames[number]
type MetricStateCounts = { received: number; invalidOption: number; documentSent: number; documentError: number; end: number }

const durationBuckets = [
  { limit: 50, label: '<=50ms' },
  { limit: 100, label: '<=100ms' },
  { limit: 250, label: '<=250ms' },
  { limit: 500, label: '<=500ms' },
  { limit: 1_000, label: '<=1s' },
  { limit: 2_500, label: '<=2.5s' },
  { limit: 5_000, label: '<=5s' },
  { limit: 10_000, label: '<=10s' },
  { limit: 30_000, label: '<=30s' },
  { limit: 60_000, label: '<=60s' },
  { limit: Number.POSITIVE_INFINITY, label: '>60s (<=24h)' }
] as const

type EventEnvelope = {
  eventType?: unknown
  context?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function knownState(value: unknown): KnownState | undefined {
  return typeof value === 'string' && (stateNames as readonly string[]).includes(value)
    ? value as KnownState
    : undefined
}

function createStateCounts(): Record<KnownState, MetricStateCounts> {
  return Object.fromEntries(stateNames.map(state => [state, {
    received: 0,
    invalidOption: 0,
    documentSent: 0,
    documentError: 0,
    end: 0
  }])) as Record<KnownState, MetricStateCounts>
}

export interface BetaMetricsSummary {
  schemaVersion: 1
  counts: {
    received: number
    invalidOption: number
    documentSent: number
    documentError: number
    reconnect: number
    end: number
    handlerDurationSamples: number
  }
  handlerDurationMs: {
    method: 'histogram-upper-bound'
    p50Approx: number | null
    p95Approx: number | null
    buckets: Record<string, number>
  }
  byState: Record<KnownState, MetricStateCounts>
  input: { malformedLines: number; oversizedLines: number }
}

/**
 * Recebe uma linha de log JSONL, nunca preserva a linha nem campos livres.
 * Estados e eventos desconhecidos sao ignorados para manter a saida limitada.
 */
export function createBetaMetricsAccumulator() {
  const counts = {
    received: 0,
    invalidOption: 0,
    documentSent: 0,
    documentError: 0,
    reconnect: 0,
    end: 0,
    handlerDurationSamples: 0
  }
  const byState = createStateCounts()
  const buckets = Object.fromEntries(durationBuckets.map(bucket => [bucket.label, 0])) as Record<string, number>
  let malformedLines = 0
  let oversizedLines = 0

  function consumeLine(line: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      malformedLines += 1
      return
    }

    if (!isRecord(parsed)) return
    const envelope = parsed as EventEnvelope
    if (!isRecord(envelope.context)) return

    const context = envelope.context
    const eventType = envelope.eventType
    const before = knownState(context.stateBefore)
    const after = knownState(context.stateAfter)

    switch (eventType) {
      case 'MESSAGE_RECEIVED':
        counts.received += 1
        if (before) byState[before].received += 1
        break
      case 'INVALID_OPTION':
        counts.invalidOption += 1
        if (before) byState[before].invalidOption += 1
        break
      case 'DOCUMENT_SENT':
        counts.documentSent += 1
        if (before) byState[before].documentSent += 1
        break
      case 'DOCUMENT_ERROR':
        counts.documentError += 1
        if (before) byState[before].documentError += 1
        break
      case 'BOT_RECONNECTING':
        counts.reconnect += 1
        break
      case 'USER_STATE_CHANGED':
        if (after === 'encerrado') {
          counts.end += 1
          byState.encerrado.end += 1
        }
        break
      case 'MESSAGE_PROCESSED': {
        const durationMs = context.durationMs
        if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000) break
        counts.handlerDurationSamples += 1
        const bucket = durationBuckets.find(candidate => durationMs <= candidate.limit)
        if (bucket) buckets[bucket.label] += 1
        break
      }
      default:
        break
    }
  }

  function consumeOversizedLine() {
    oversizedLines += 1
  }

  function percentileUpperBound(percentile: number) {
    if (counts.handlerDurationSamples === 0) return null
    const rank = Math.ceil(counts.handlerDurationSamples * percentile)
    let cumulative = 0
    for (const bucket of durationBuckets) {
      cumulative += buckets[bucket.label]
      if (cumulative >= rank) return Number.isFinite(bucket.limit) ? bucket.limit : 86_400_000
    }
    return null
  }

  function snapshot(): BetaMetricsSummary {
    return {
      schemaVersion: 1,
      counts: { ...counts },
      handlerDurationMs: {
        method: 'histogram-upper-bound',
        p50Approx: percentileUpperBound(0.5),
        p95Approx: percentileUpperBound(0.95),
        buckets: { ...buckets }
      },
      byState,
      input: { malformedLines, oversizedLines }
    }
  }

  return { consumeLine, consumeOversizedLine, snapshot }
}
