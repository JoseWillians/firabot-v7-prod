import assert from 'node:assert/strict'
import { getCurrentUserStateResult, updateUserState } from '../dist/services/userStateService.js'
import { handleSupportMessage } from '../dist/flows/supportFlow.js'
import { isDocumentMenuCurrent, rememberDocumentMenu } from '../dist/services/documentMenuSnapshotService.js'
import { processDocsCategoryOption, processDrcaDocsOption, processCaeDocsOption } from '../dist/flows/documentsFlow.js'
import { processCourseSelectionOption, processPpcDocumentOption } from '../dist/flows/courseFlow.js'
import { createConversationQueue, runInConversationQueue } from '../dist/services/messageQueueService.js'

const quiet = { botLog() {}, debugLog() {}, errorLog() {} }
let available = false
let stored = 'main'
const stateDependencies = {
  ...quiet,
  async getUserStateRecord() {
    if (!available) throw new Error('offline')
    return { state: stored, updatedAt: new Date() }
  },
  async setUserState(_jid, state) {
    if (!available) throw new Error('offline')
    stored = state
  }
}
const jid = 'recovery-test@s.whatsapp.net'
await updateUserState(jid, 'docs_drca', stateDependencies)
assert.deepEqual(await getCurrentUserStateResult(jid, stateDependencies), {
  state: 'docs_drca', source: 'memory', databaseAvailable: false
})
available = true
assert.equal((await getCurrentUserStateResult(jid, stateDependencies)).state, 'docs_drca')
assert.equal(stored, 'docs_drca', 'recovery must reconcile the pending submenu before routing')
await updateUserState(jid, 'main', stateDependencies)
assert.equal((await getCurrentUserStateResult(jid, stateDependencies)).state, 'main')
console.log('PASS recovery reconciles state without reverting the submenu')

const messages = []
const effects = []
const sock = { async sendMessage(_jid, content) { messages.push(content.text) } }
let fail = true
const dependencies = {
  ...quiet,
  async createSupportTicket(_jid, _name, content) {
    if (fail) throw new Error('offline')
    assert.doesNotMatch(content, /segredo/)
    effects.push('persisted')
  },
  async registerUserLog() { effects.push('logged') },
  async updateUserState(_jid, state) { effects.push(state); return state },
  async sendFollowUp() { effects.push('followup') }
}
await handleSupportMessage(sock, jid, 'Teste', 'senha: segredo', 'suporte', dependencies)
assert.deepEqual(effects, [])
assert.equal(messages.length, 1)
assert.match(messages[0], /503/)
assert.doesNotMatch(messages[0], /Sua mensagem foi registrada/)
fail = false
await handleSupportMessage(sock, jid, 'Teste', 'senha: segredo', 'suporte', dependencies)
assert.deepEqual(effects, ['persisted', 'suporte_confirmacao', 'logged', 'followup'])
assert.match(messages[1], /Sua mensagem foi registrada/)
console.log('PASS support only acknowledges and advances after persistence')

for (const state of ['docs_drca', 'docs_cae', 'curso_eng_comp']) {
  const user = `snapshot-${state}@s.whatsapp.net`
  let catalog = [{ key: '1', label: 'Arquivo A', path: './documentos/a.pdf' }]
  const sent = []
  const texts = []
  const socket = { async sendMessage(_jid, content) { texts.push(content.text) } }
  const deps = {
    async listDocuments() { return catalog },
    async listPpcs() { return catalog },
    async setState(_jid, next) { return next },
    async writeUserLog() {},
    async sendTracked(...args) { sent.push(args[5]) }
  }
  if (state.startsWith('docs_')) {
    await processDocsCategoryOption(socket, user, 'Teste', state === 'docs_drca' ? '1' : '2', 'docs', deps)
  } else {
    await processCourseSelectionOption(socket, user, 'Teste', '1', 'curso', deps)
  }
  assert.match(texts.at(-1), /1 - Arquivo A/)
  const select = state === 'docs_drca' ? processDrcaDocsOption : state === 'docs_cae' ? processCaeDocsOption : processPpcDocumentOption
  catalog = [{ key: '1', label: 'Arquivo B', path: './documentos/b.pdf' }]
  await select(socket, user, 'Teste', '1', state, deps)
  assert.equal(sent.length, 0, 'changed menu must never send a different file silently')
  assert.match(texts.at(-1), /Escolha novamente/)
  assert.match(texts.at(-1), /1 - Arquivo B/)
  await select(socket, user, 'Teste', '1', state, deps)
  assert.equal(sent[0].label, 'Arquivo B')
  console.log(`PASS ${state} refreshes changed catalog and requires a new selection`)
}

const original = [{ key: '1', label: 'Original', path: './a.pdf' }]
rememberDocumentMenu('expiry', 'docs_drca', original, 100)
assert.equal(isDocumentMenuCurrent('expiry', 'docs_drca', original, 101), true)
original[0].label = 'Mutated'
assert.equal(isDocumentMenuCurrent('expiry', 'docs_drca', original, 101), false)
assert.equal(isDocumentMenuCurrent('other-user', 'docs_drca', original, 101), false)
assert.equal(isDocumentMenuCurrent('expiry', 'docs_cae', original, 101), false)
assert.equal(isDocumentMenuCurrent('expiry', 'docs_drca', original, 1800100), false)
console.log('PASS document snapshots are isolated, copied and expire')

let release
const gate = new Promise(resolve => { release = resolve })
const order = []
const first = runInConversationQueue('queue-A', async () => { order.push('first'); await gate; order.push('done') })
const second = runInConversationQueue('queue-A', async () => { order.push('second') })
await runInConversationQueue('queue-B', async () => { order.push('independent') })
assert.deepEqual(order, ['first', 'independent'])
release()
await Promise.all([first, second])
assert.deepEqual(order, ['first', 'independent', 'done', 'second'])
await assert.rejects(runInConversationQueue('queue-A', async () => { throw new Error('expected') }), /expected/)
await runInConversationQueue('queue-A', async () => { order.push('recovered') })
assert.equal(order.at(-1), 'recovered')
console.log('PASS conversation queues serialize same-user work and recover after failure')

const boundedQueue = createConversationQueue({ maxConversations: 1, maxPendingPerConversation: 2 })
let releaseBounded
const boundedGate = new Promise(resolve => { releaseBounded = resolve })
const active = boundedQueue.run('bounded-A', async () => boundedGate)
const queued = boundedQueue.run('bounded-A', async () => {})
await assert.rejects(boundedQueue.run('bounded-A', async () => {}), error => error.code === 429)
await assert.rejects(boundedQueue.run('bounded-B', async () => {}), error => error.code === 429)
releaseBounded()
await Promise.all([active, queued])
await boundedQueue.run('bounded-B', async () => {})
console.log('PASS conversation queues reject excess work and release capacity')
