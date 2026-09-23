import assert from 'node:assert/strict'
import { messageHandler } from '../dist/middlewares/messageHandler.js'
import { handleSupportMessage } from '../dist/flows/supportFlow.js'
import { getCurrentUserStateResult, updateUserState, canSafelyRouteNumericInput } from '../dist/services/userStateService.js'

const quiet = { botLog() {}, errorLog() {}, debugLog() {} }
let stored = 'suporte'
const stateDeps = { ...quiet, getUserStateRecord: async () => ({ state: stored, updatedAt: new Date() }), setUserState: async (_jid, state) => { stored = state } }
const cold = 'restart-confirmation@s.whatsapp.net'
const lookup = await getCurrentUserStateResult(cold, stateDeps)
assert.equal(lookup.requiresMenuConfirmation, true, 'cold conversation must not trust stale DB state after restart')
assert.equal(canSafelyRouteNumericInput(lookup), false)
assert.equal((await getCurrentUserStateResult(cold, stateDeps)).requiresMenuConfirmation, true)
await updateUserState(cold, 'main', stateDeps)
assert.equal(canSafelyRouteNumericInput(await getCurrentUserStateResult(cold, stateDeps)), true)
console.log('PASS cold conversations require a new choice until an explicit transition')

const effects = []
await assert.rejects(handleSupportMessage({ sendMessage: async () => { throw new Error('ack unavailable') } }, 'ack-test', 'Test', 'duvida', 'suporte', {
  ...quiet, createSupportTicket: async () => { effects.push('ticket') },
  updateUserState: async (_jid, state) => { effects.push(state); return state },
  registerUserLog: async () => {}, sendFollowUp: async () => {}
}), /ack unavailable/)
assert.deepEqual(effects, ['ticket', 'suporte_confirmacao'])
console.log('PASS committed support ticket advances state before an acknowledgement failure')

let release
const gate = new Promise(resolve => { release = resolve })
let first = true
const order = []
const deps = {
  now: () => 100000, shouldProcessId: () => true, canRespond: () => true,
  upsertIdentity: async () => {}, getUserState: async () => {
    if (first) { first = false; await gate }
    return { state: 'main', source: 'database', databaseAvailable: true }
  },
  cancelFollowUp() {}, withLogContext: (_id, fn) => fn(), writeBotLog() {}, writeDebugLog() {}, writeErrorLog() {},
  handleMenuOption: async (_sock, _jid, _name, option) => { order.push(option) }
}
const msg = text => ({ key: { id: `order-${text}`, remoteJid: 'order-test@s.whatsapp.net' }, messageTimestamp: 100, message: { conversation: text } })
const batchA = messageHandler({}, { messages: [msg('1'), msg('2')] }, { startedAt: 99 }, deps)
const batchB = messageHandler({}, { messages: [msg('3')] }, { startedAt: 99 }, deps)
release()
await Promise.all([batchA, batchB])
assert.deepEqual(order, ['1', '2', '3'])
console.log('PASS overlapping upserts retain arrival order within each conversation')

const sent = []
let transitions = 0
await messageHandler({ sendMessage: async (_jid, content) => { sent.push(content.text) } }, { messages: [msg('5')] }, { startedAt: 99 }, {
  ...deps, getUserState: async () => ({ state: 'suporte', source: 'database', databaseAvailable: true, requiresMenuConfirmation: true }),
  sendMain: async () => { sent.push('main menu') }, updateState: async () => { transitions++; return 'main' },
  handleSupport: async () => { throw new Error('must not create support ticket on cold context') },
  handleMenuOption: async () => { throw new Error('must not route old choice') }
})
assert.equal(transitions, 1)
assert.equal(sent.at(-1), 'main menu')
console.log('PASS cold-context message shows main menu without interpreting the old choice')
