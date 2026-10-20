import { config } from '../config.js'
import { replaceSyncedNotices, type SyncedNoticeInput } from '../functions/database.js'
import { botLog, debugLog, errorLog } from './logService.js'

export const IFMA_ALL_NOTICES_URL = 'https://portal.ifma.edu.br/concursos-e-seletivos/'
export const IFMA_SANTA_INES_NOTICES_URL = 'https://portal.ifma.edu.br/concursos-e-seletivos/?campus=32'
export const IFMA_SANTA_INES_FALLBACK_URL = 'https://santaines.ifma.edu.br/concursos-e-seletivos/'
export const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const DEFAULT_FETCH_TIMEOUT_MS = 10_000

const allowedHostnames = new Set(['portal.ifma.edu.br', 'santaines.ifma.edu.br', 'processoseletivo.ifma.edu.br'])

export interface SyncedNoticeItem {
  title: string
  url: string
  status: 'inscricoes_abertas' | 'em_andamento'
}

export interface SyncNoticesOptions {
  force?: boolean
  now?: number
  intervalMs?: number
  fetchHtml?: (url: string) => Promise<string>
  saveNotices?: (notices: SyncedNoticeInput[]) => Promise<void>
}

export interface NoticesAutoSyncSchedulerOptions {
  intervalMs?: number
  sync?: () => Promise<SyncedNoticeItem[]>
  setTimer?: (callback: () => void | Promise<void>, delayMs: number) => unknown
  clearTimer?: (handle: unknown) => void
  onError?: (error: unknown) => void
}

const namedHtmlEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
  aacute: 'á',
  Aacute: 'Á',
  acirc: 'â',
  Acirc: 'Â',
  atilde: 'ã',
  Atilde: 'Ã',
  agrave: 'à',
  Agrave: 'À',
  eacute: 'é',
  Eacute: 'É',
  ecirc: 'ê',
  Ecirc: 'Ê',
  iacute: 'í',
  Iacute: 'Í',
  oacute: 'ó',
  Oacute: 'Ó',
  ocirc: 'ô',
  Ocirc: 'Ô',
  otilde: 'õ',
  Otilde: 'Õ',
  uacute: 'ú',
  Uacute: 'Ú',
  ccedil: 'ç',
  Ccedil: 'Ç'
}

let cachedNotices: SyncedNoticeItem[] = []
let lastSyncedAt = 0
let inFlightSync: Promise<SyncedNoticeItem[]> | null = null

export function isAllowedIfmaNoticesUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    if (parsed.port && parsed.port !== '443') return false
    return allowedHostnames.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number(dec)
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _match
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _match
    })
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => namedHtmlEntities[name] ?? match)
}

function cleanText(rawHtml: string): string {
  return decodeHtmlEntities(rawHtml.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeIfmaNoticeUrl(rawHref: string): string | null {
  const decodedHref = decodeHtmlEntities(rawHref.trim())
  try {
    const parsed = new URL(decodedHref, IFMA_ALL_NOTICES_URL)
    if (!isAllowedIfmaNoticesUrl(parsed.toString())) return null

    const id = parsed.searchParams.get('id')?.trim()
    if (id && /^\d+$/.test(id)) {
      return `${IFMA_ALL_NOTICES_URL}?id=${id}`
    }

    return parsed.toString()
  } catch {
    return null
  }
}

function resolveNoticeStatus(blockHtml: string): 'inscricoes_abertas' | 'em_andamento' {
  const situacaoMatch = blockHtml.match(/page-editais--edital__situacao[^>]*>([\s\S]*?)<\/span>/i)
  const situacaoText = cleanText(situacaoMatch?.[1] || '').toLowerCase()
  if (situacaoText.includes('inscri') || situacaoText.includes('abert')) {
    return 'inscricoes_abertas'
  }
  return 'em_andamento'
}

/**
 * Extrai até 10 editais do HTML da listagem do Portal do IFMA (Campus Santa Inês).
 * O portal já ordena a listagem pelos editais atualizados mais recentemente no SUAP.
 */
export function parseIfmaSantaInesNoticesHtml(html: string, limit = 10): SyncedNoticeItem[] {
  const results: SyncedNoticeItem[] = []
  const seenUrls = new Set<string>()
  const blocks = html.split(/<div\s+class=["'][^"']*page-editais--edital(?:\s|["'])/i).slice(1)

  for (const block of blocks) {
    if (results.length >= limit) break

    const linkAndTitleMatch = block.match(
      /<a\s+[^>]*href=["']([^"']+)["'][^>]*>\s*<h2\s+class=["'][^"']*page-editais--edital__titulo[^"']*["'][^>]*>([\s\S]*?)<\/h2>\s*<\/a>/i
    )
    if (!linkAndTitleMatch) continue

    const url = normalizeIfmaNoticeUrl(linkAndTitleMatch[1])
    const title = cleanText(linkAndTitleMatch[2])
    if (!url || !title || seenUrls.has(url)) continue

    seenUrls.add(url)
    results.push({
      title,
      url,
      status: resolveNoticeStatus(block)
    })
  }

  return results
}

export async function fetchHtmlFromIfmaPortal(url: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<string> {
  if (!isAllowedIfmaNoticesUrl(url)) {
    throw new Error('URL de sincronização de editais não permitida.')
  }

  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Firabot-IFMA-SantaInes/7.0'
    }
  })

  if (!response.ok) {
    throw new Error(`Portal IFMA retornou status HTTP ${response.status}`)
  }

  if (response.url && !isAllowedIfmaNoticesUrl(response.url)) {
    throw new Error('Redirecionamento externo bloqueado na busca de editais.')
  }

  return response.text()
}

export function getCachedSantaInesNotices(): SyncedNoticeItem[] {
  return [...cachedNotices]
}

export function isNoticesSyncFresh(now = Date.now(), intervalMs = getConfiguredSyncIntervalMs()): boolean {
  if (!cachedNotices.length || lastSyncedAt <= 0) return false
  const effectiveInterval = intervalMs > 0 ? intervalMs : SIX_HOURS_MS
  return now - lastSyncedAt < effectiveInterval
}

export function getConfiguredSyncIntervalMs(): number {
  return config.noticesSyncIntervalMinutes > 0 ? config.noticesSyncIntervalMinutes * 60 * 1000 : SIX_HOURS_MS
}

export async function syncSantaInesNotices(options: SyncNoticesOptions = {}): Promise<SyncedNoticeItem[]> {
  const now = options.now ?? Date.now()
  const intervalMs = options.intervalMs ?? getConfiguredSyncIntervalMs()

  if (!options.force && isNoticesSyncFresh(now, intervalMs)) {
    return getCachedSantaInesNotices()
  }

  if (inFlightSync && !options.fetchHtml && !options.saveNotices) {
    return inFlightSync
  }

  const runSync = async (): Promise<SyncedNoticeItem[]> => {
    const fetchHtml = options.fetchHtml ?? fetchHtmlFromIfmaPortal
    const saveNotices = options.saveNotices ?? replaceSyncedNotices
    const candidateUrls = [IFMA_SANTA_INES_NOTICES_URL, IFMA_SANTA_INES_FALLBACK_URL]

    let parsedNotices: SyncedNoticeItem[] = []
    let lastFetchError: unknown = null

    for (const url of candidateUrls) {
      try {
        const html = await fetchHtml(url)
        const extracted = parseIfmaSantaInesNoticesHtml(html, 10)
        if (extracted.length > 0) {
          parsedNotices = extracted
          break
        }
      } catch (error) {
        lastFetchError = error
      }
    }

    if (!parsedNotices.length) {
      throw lastFetchError instanceof Error
        ? lastFetchError
        : new Error('Não foi possível extrair editais atualizados de Santa Inês no portal do IFMA.')
    }

    cachedNotices = parsedNotices
    lastSyncedAt = now

    try {
      await saveNotices(
        parsedNotices.map((item) => ({
          title: item.title,
          url: item.url,
          status: item.status === 'inscricoes_abertas' ? 'Inscrições abertas' : 'Em andamento',
          source: IFMA_ALL_NOTICES_URL
        }))
      )
      debugLog('Editais de Santa Inês sincronizados com sucesso no MySQL', {
        eventType: 'DATABASE_CONNECTED',
        resultCode: 200,
        total: parsedNotices.length
      })
    } catch (dbError) {
      errorLog(
        'DATABASE_ERROR',
        'Editais do IFMA foram buscados no portal, mas não puderam ser salvos no MySQL; mantendo cache em memória.',
        dbError
      )
    }

    return getCachedSantaInesNotices()
  }

  if (options.fetchHtml || options.saveNotices) {
    return runSync()
  }

  inFlightSync = runSync().finally(() => {
    inFlightSync = null
  })
  return inFlightSync
}

export function createNoticesAutoSyncScheduler(options: NoticesAutoSyncSchedulerOptions = {}) {
  const intervalMs = options.intervalMs ?? getConfiguredSyncIntervalMs()
  const sync = options.sync ?? (() => syncSantaInesNotices({ force: true }))
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout))
  const onError =
    options.onError ??
    ((error: unknown) => {
      errorLog('UNKNOWN_ERROR', 'Falha na sincronização automática periódica de editais do IFMA', error)
    })

  let timer: unknown | null = null
  let stopped = false
  let activeWork: Promise<void> | null = null

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  const runCycle = async () => {
    if (stopped) return
    const work = (async () => {
      try {
        const items = await sync()
        botLog('BOT_STARTED', 'Lista de editais de Santa Inês sincronizada automaticamente.', {
          totalNotices: items.length,
          nextSyncHours: Number((intervalMs / (60 * 60 * 1000)).toFixed(1))
        })
      } catch (error) {
        onError(error)
      }
    })()

    activeWork = work
    try {
      await work
    } finally {
      if (activeWork === work) activeWork = null
    }
  }

  const scheduleNext = () => {
    if (stopped || intervalMs <= 0) return
    cancelTimer()
    timer = setTimer(async () => {
      cancelTimer()
      if (stopped) return
      await runCycle()
      scheduleNext()
    }, intervalMs)
  }

  const start = async () => {
    stopped = false
    await runCycle()
    scheduleNext()
  }

  const stop = async () => {
    stopped = true
    cancelTimer()
    if (activeWork) {
      await Promise.allSettled([activeWork])
    }
  }

  return { start, stop }
}

const defaultScheduler = createNoticesAutoSyncScheduler()

export async function startNoticesAutoSync() {
  if (config.noticesSyncIntervalMinutes <= 0) return
  await defaultScheduler.start()
}

export async function stopNoticesAutoSync() {
  await defaultScheduler.stop()
}
