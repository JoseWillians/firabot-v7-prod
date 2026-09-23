import assert from 'node:assert/strict'
import { getAvailableDocuments } from '../dist/services/documentService.js'
import { getAvailablePpcDocuments } from '../dist/services/courseDocumentService.js'
import { processDocsCategoryOption, processDrcaDocsOption, processCaeDocsOption } from '../dist/flows/documentsFlow.js'
import { processCourseSelectionOption, processPpcDocumentOption } from '../dist/flows/courseFlow.js'
import { rememberDocumentMenu, isDocumentMenuCurrent } from '../dist/services/documentMenuSnapshotService.js'

const tests = []
const test = (name, run) => tests.push({ name, run })
const doc = { key: '1', label: 'Documento sintético', path: 'drca/sintetico.pdf', summary: 'Resumo sintético' }
const row = { id: 1, name: doc.label, path: doc.path, summary: doc.summary }
const courseState = 'curso_eng_comp'

function fixture(list) {
  const events = []
  return {
    events,
    sock: { async sendMessage(jid, body) { events.push({ type: 'message', jid, body }) } },
    deps: {
      listDocuments: list,
      listPpcs: list,
      async setState(jid, state) { events.push({ type: 'state', state }); return state },
      async writeUserLog(...args) { events.push({ type: 'log', args }) },
      async sendTracked(...args) { events.push({ type: 'send', document: args[5] }) }
    }
  }
}

test('catálogo vazio é autoritativo em DRCA, CAE e PPC, sem fallback', async () => {
  for (const category of ['drca', 'cae', 'ppc_eng_comp']) {
    const calls = []
    const docs = await getAvailableDocuments(category, async (...args) => { calls.push(args); return [] })
    assert.deepEqual(docs, [])
    assert.deepEqual(calls, [[category, { throwOnError: true }]])
  }
  const calls = []
  assert.deepEqual(await getAvailablePpcDocuments(courseState, async category => { calls.push(category); return [] }), [])
  assert.equal(calls.length, 1)
})

test('falha de consulta tem erro 503 sanitizado e recupera na próxima consulta', async () => {
  await assert.rejects(
    getAvailableDocuments('drca', async () => { throw new Error('mysql://segredo@host/caminho') }),
    error => error.name === 'DocumentCatalogUnavailableError' && error.code === 503 && !error.message.includes('segredo') && !error.cause
  )
  assert.deepEqual(await getAvailableDocuments('drca', async () => [row]), [doc])
  await assert.rejects(getAvailablePpcDocuments(courseState, async () => {
    return getAvailableDocuments('ppc_eng_comp', async () => { throw new Error('indisponível') })
  }), error => error.code === 503)
})

test('abrir DRCA, CAE ou PPC com catálogo vazio informa ausência de documentos', async () => {
  for (const [flow, option, state] of [
    [processDocsCategoryOption, '1', 'docs'],
    [processDocsCategoryOption, '2', 'docs'],
    [processCourseSelectionOption, '1', 'curso']
  ]) {
    const f = fixture(async () => [])
    await flow(f.sock, `vazio-${option}-${state}`, 'Teste', option, state, f.deps)
    assert.match(f.events[0].body.text, /não há documentos/i)
    assert.doesNotMatch(f.events[0].body.text, /Escolha uma opção digitando/)
    assert.equal(f.events.filter(e => e.type === 'send').length, 0)
  }
})

test('indisponibilidade em abertura e seleção não muda estado nem snapshot ou envia PDF', async () => {
  const unavailable = () => getAvailableDocuments('drca', async () => { throw new Error('falha sintética') })
  for (const [flow, option, state, target] of [
    [processDocsCategoryOption, '1', 'docs', 'docs_drca'],
    [processDocsCategoryOption, '2', 'docs', 'docs_cae'],
    [processCourseSelectionOption, '1', 'curso', courseState],
    [processDrcaDocsOption, '1', 'docs_drca', 'docs_drca'],
    [processCaeDocsOption, '1', 'docs_cae', 'docs_cae'],
    [processPpcDocumentOption, '1', courseState, courseState]
  ]) {
    const jid = `outage-${flow.name}-${option}`
    rememberDocumentMenu(jid, target, [doc])
    const f = fixture(unavailable)
    await flow(f.sock, jid, 'Teste', option, state, f.deps)
    assert.deepEqual(f.events.map(e => e.type), ['message'])
    assert.match(f.events[0].body.text, /503/)
    assert.match(f.events[0].body.text, /menu/i)
    assert.equal(isDocumentMenuCurrent(jid, target, [doc]), true)
    assert.equal(isDocumentMenuCurrent(jid, target, []), false)
  }
})

test('desativação após menu e recuperação de outage nunca enviam PDF antigo ou renumerado', async () => {
  for (const [flow, state] of [[processDrcaDocsOption, 'docs_drca'], [processCaeDocsOption, 'docs_cae'], [processPpcDocumentOption, courseState]]) {
    const jid = `recovery-${state}`
    let rows = [row]
    let offline = false
    const list = () => getAvailableDocuments('drca', async () => {
      if (offline) throw new Error('indisponível')
      return rows
    })
    const f = fixture(list)
    rememberDocumentMenu(jid, state, [doc])
    rows = []
    await flow(f.sock, jid, 'Teste', '1', state, f.deps)
    assert.equal(f.events.some(e => e.type === 'send'), false)
    assert.match(f.events[0].body.text, /não há documentos/i)
    assert.equal(isDocumentMenuCurrent(jid, state, []), true)
    offline = true
    await flow(f.sock, jid, 'Teste', '1', state, f.deps)
    assert.match(f.events.at(-1).body.text, /503/)
    offline = false
    rows = [{ ...row, name: 'Documento novo', path: 'drca/novo.pdf' }]
    await flow(f.sock, jid, 'Teste', '1', state, f.deps)
    assert.equal(f.events.some(e => e.type === 'send'), false)
    assert.match(f.events.filter(e => e.type === 'message').at(-1).body.text, /Escolha novamente/)
    await flow(f.sock, jid, 'Teste', '1', state, f.deps)
    assert.deepEqual(f.events.filter(e => e.type === 'send').map(e => e.document.path), ['drca/novo.pdf'])
  }
})

test('erros inesperados continuam propagando para isolamento do handler', async () => {
  const error = new Error('bug sintético')
  const f = fixture(async () => { throw error })
  await assert.rejects(processDocsCategoryOption(f.sock, 'bug', 'Teste', '1', 'docs', f.deps), error)
  assert.deepEqual(f.events, [])
})

for (const { name, run } of tests) {
  await run()
  console.log(`✓ ${name}`)
}
console.log(`${tests.length} testes de política de catálogo passaram.`)
