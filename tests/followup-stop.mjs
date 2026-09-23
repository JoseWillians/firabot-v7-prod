import assert from 'node:assert/strict'
import * as flow from '../dist/flows/conversationFlow.js'
assert.equal(typeof flow.stopPendingFollowUps, 'function')
let sends = 0
const sock = { async sendMessage() { sends++ } }
await flow.sendFollowUp(sock, 'scheduled', 20)
await flow.stopPendingFollowUps()
await flow.sendFollowUp(sock, 'late', 0)
await flow.sendContextualFollowUp(sock, 'late-context', [], '1')
await new Promise(resolve => setTimeout(resolve, 35))
assert.equal(sends, 0)
await flow.stopPendingFollowUps()
console.log('PASS shutdown cancels scheduled and prevents new followups')
