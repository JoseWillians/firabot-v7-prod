import assert from 'node:assert/strict'
import { formatOpenNoticesMessage, NoticesUnavailableError } from '../dist/menus/noticesMenu.js'
import { formatImportantLinksMessage, ImportantLinksUnavailableError } from '../dist/services/importantLinkService.js'
import { processMainOption } from '../dist/flows/mainMenuFlow.js'

const noticesEmpty = await formatOpenNoticesMessage({ listNotices: async () => [] })
assert.match(noticesEmpty, /Não há editais ativos cadastrados/)
assert.doesNotMatch(noticesEmpty, /Edital Nº 143\/2026/)

const linksEmpty = await formatImportantLinksMessage({ listLinks: async () => [] })
assert.match(linksEmpty, /Não há links ativos cadastrados/)
assert.doesNotMatch(linksEmpty, /SUAP IFMA/)

await assert.rejects(
  formatOpenNoticesMessage({ listNotices: async () => { throw new Error('db secret') } }),
  error => error.name === 'NoticesUnavailableError'
)
await assert.rejects(
  formatImportantLinksMessage({ listLinks: async () => { throw new Error('db secret') } }),
  error => error.name === 'ImportantLinksUnavailableError'
)

for (const [option, UnavailableError, formatMethod] of [
  ['4', ImportantLinksUnavailableError, 'formatLinks'],
  ['5', NoticesUnavailableError, 'formatNotices']
]) {
  const sent = []
  const states = []
  let followUps = 0
  const unavailable = new UnavailableError()
  await processMainOption(
    { async sendMessage(_jid, content) { sent.push(content.text) } },
    `user-${option}`,
    'Teste',
    option,
    'main',
    {
      [formatMethod]: async () => { throw unavailable },
      async sendFollowUp() { followUps++ },
      async setState(_jid, state) { states.push(state); return state },
      async writeUserLog() {},
      writeBotLog() {},
      async openSupport() {}
    }
  )
  assert.match(sent[0], /503/)
  assert.deepEqual(states, [])
  assert.equal(followUps, 0)
}

console.log('PASS links e editais distinguem vazio, falha e fallback de teste')
