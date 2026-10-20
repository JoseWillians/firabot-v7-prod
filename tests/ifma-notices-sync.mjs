import assert from 'node:assert/strict'
import {
  IFMA_ALL_NOTICES_URL,
  IFMA_SANTA_INES_NOTICES_URL,
  SIX_HOURS_MS,
  createNoticesAutoSyncScheduler,
  isAllowedIfmaNoticesUrl,
  parseIfmaSantaInesNoticesHtml,
  syncSantaInesNotices
} from '../dist/services/ifmaNoticesSyncService.js'
import { formatOpenNoticesMessage } from '../dist/menus/noticesMenu.js'

const tests = []
const test = (name, run) => tests.push({ name, run })

function buildPortalHtmlFixture(count = 12) {
  const blocks = Array.from({ length: count }, (_, idx) => {
    const num = idx + 1
    const id = 21300 - idx
    const host = idx === 1 ? 'santaines.ifma.edu.br' : 'portal.ifma.edu.br'
    const situacao = idx === 0 ? 'Inscrições abertas' : 'Andamento'
    return `
      <div class="row-fluid page-editais--edital">
        <div class="page-editais--edital__principal">
          <a href="https://${host}/concursos-e-seletivos/?id=${id}">
            <h2 class="page-editais--edital__titulo">
              Edital N&deg; ${300 + num}/2026 &ndash; Sele&ccedil;&atilde;o Campus Santa In&ecirc;s #${num}
            </h2>
          </a>
        </div>
        <div class="page-editais--edital__secundario">
          <div class="page-editais--edital__informacoes">
            <h4>Informações:</h4>
            <ul>
              <li><i class="icon-fixed-width icon-calendar"></i> 21/09/2026</li>
              <li><i class="icon-fixed-width icon-home"></i> Santa Inês</li>
              <li><i class="icon-fixed-width icon-tasks"></i> <span class="page-editais--edital__situacao--verde">${situacao}</span></li>
            </ul>
          </div>
        </div>
      </div>
    `
  }).join('\n')

  return `<!doctype html><html><body>${blocks}</body></html>`
}

test('constantes de URL e intervalo de 6 horas estão configurados corretamente', () => {
  assert.equal(IFMA_ALL_NOTICES_URL, 'https://portal.ifma.edu.br/concursos-e-seletivos/')
  assert.equal(IFMA_SANTA_INES_NOTICES_URL, 'https://portal.ifma.edu.br/concursos-e-seletivos/?campus=32')
  assert.equal(SIX_HOURS_MS, 6 * 60 * 60 * 1000)
})

test('valida URLs permitidas do portal do IFMA contra SSRF', () => {
  assert.equal(isAllowedIfmaNoticesUrl('https://portal.ifma.edu.br/concursos-e-seletivos/?campus=32'), true)
  assert.equal(isAllowedIfmaNoticesUrl('https://santaines.ifma.edu.br/concursos-e-seletivos/?id=21293'), true)
  assert.equal(isAllowedIfmaNoticesUrl('http://portal.ifma.edu.br/concursos-e-seletivos/'), false)
  assert.equal(isAllowedIfmaNoticesUrl('https://portal.ifma.edu.br:8080/concursos-e-seletivos/'), false)
  assert.equal(isAllowedIfmaNoticesUrl('https://user:pass@portal.ifma.edu.br/concursos-e-seletivos/'), false)
  assert.equal(isAllowedIfmaNoticesUrl('https://atacante.exemplo.com/concursos-e-seletivos/'), false)
  assert.equal(isAllowedIfmaNoticesUrl('notaurl'), false)
})

test('extrai os 10 últimos editais de Santa Inês com título decodificado e link normalizado', () => {
  const html = buildPortalHtmlFixture(12)
  const notices = parseIfmaSantaInesNoticesHtml(html)

  assert.equal(notices.length, 10)
  assert.equal(notices[0].title, 'Edital N° 301/2026 – Seleção Campus Santa Inês #1')
  assert.equal(notices[0].url, 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21300')
  assert.equal(notices[0].status, 'inscricoes_abertas')

  // O 2º item veio com host santaines.ifma.edu.br e deve ser normalizado para portal.ifma.edu.br
  assert.equal(notices[1].url, 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21299')
  assert.equal(notices[1].status, 'em_andamento')
  assert.equal(notices[9].url, 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21291')
})

test('sincroniza editais com fallback para subdomínio de Santa Inês e persiste no banco', async () => {
  const saved = []
  const urlsCalled = []
  const html = buildPortalHtmlFixture(10)

  const synced = await syncSantaInesNotices({
    force: true,
    fetchHtml: async (url) => {
      urlsCalled.push(url)
      if (url.includes('portal.ifma.edu.br')) {
        throw new Error('timeout temporário no portal principal')
      }
      return html
    },
    saveNotices: async (items) => {
      saved.push(...items)
    }
  })

  assert.equal(urlsCalled.length, 2)
  assert.equal(synced.length, 10)
  assert.equal(saved.length, 10)
  assert.equal(saved[0].url, 'https://portal.ifma.edu.br/concursos-e-seletivos/?id=21300')
})

test('agendador automático executa sincronização inicial e a cada 6 horas e cancela no stop', async () => {
  const timers = new Map()
  let timerId = 0
  let syncCalls = 0

  const scheduler = createNoticesAutoSyncScheduler({
    intervalMs: SIX_HOURS_MS,
    sync: async () => {
      syncCalls += 1
      return []
    },
    setTimer: (callback, delayMs) => {
      const id = ++timerId
      timers.set(id, { callback, delayMs })
      return id
    },
    clearTimer: (id) => {
      timers.delete(id)
    }
  })

  await scheduler.start()
  assert.equal(syncCalls, 1)
  assert.equal(timers.size, 1)
  const firstTimer = timers.values().next().value
  assert.equal(firstTimer.delayMs, SIX_HOURS_MS)

  await firstTimer.callback()
  assert.equal(syncCalls, 2)

  await scheduler.stop()
  assert.equal(timers.size, 0)
})

test('mensagem formatada lista os 10 editais com seus links e inclui link geral da rede IFMA ao final', async () => {
  const html = buildPortalHtmlFixture(10)
  const parsed = parseIfmaSantaInesNoticesHtml(html)

  const message = await formatOpenNoticesMessage({
    listNotices: async () =>
      parsed.map((item, idx) => ({
        title: item.title,
        url: item.url,
        status: item.status === 'inscricoes_abertas' ? 'Inscrições abertas' : 'Em andamento',
        source: IFMA_ALL_NOTICES_URL,
        sort_order: idx + 1
      }))
  })

  assert.match(message, /1\. Edital N° 301\/2026/)
  assert.match(message, /https:\/\/portal\.ifma\.edu\.br\/concursos-e-seletivos\/\?id=21300/)
  assert.match(message, /10\. Edital N° 310\/2026/)
  assert.match(message, /https:\/\/portal\.ifma\.edu\.br\/concursos-e-seletivos\/\?id=21291/)
  assert.match(message, /https:\/\/portal\.ifma\.edu\.br\/concursos-e-seletivos\/$/)
})

test('substitui seed legado ou usa cache sincronizado quando o banco está vazio ou indisponível', async () => {
  let forcedSyncCalls = 0

  const messageFromLegacySeed = await formatOpenNoticesMessage({
    listNotices: async () => [
      {
        title: 'Editais disponíveis no campus',
        url: 'https://processoseletivo.ifma.edu.br/',
        status: 'Ativo',
        source: 'Site oficial do campus'
      }
    ],
    syncNotices: async (opts) => {
      if (opts?.force) forcedSyncCalls += 1
      return []
    }
  })

  assert.equal(forcedSyncCalls, 1)
  assert.match(messageFromLegacySeed, /1\. Edital N° 301\/2026/)
  assert.doesNotMatch(messageFromLegacySeed, /processoseletivo\.ifma\.edu\.br/)

  const messageWhenDbThrows = await formatOpenNoticesMessage({
    listNotices: async () => {
      throw new Error('mysql offline')
    },
    syncNotices: async () => []
  })

  assert.match(messageWhenDbThrows, /1\. Edital N° 301\/2026/)
  assert.match(messageWhenDbThrows, /https:\/\/portal\.ifma\.edu\.br\/concursos-e-seletivos\/$/)
})

for (const { name, run } of tests) {
  await run()
  console.log(`✓ ${name}`)
}
console.log(`${tests.length} testes de sincronização automática de editais do IFMA passaram.`)
