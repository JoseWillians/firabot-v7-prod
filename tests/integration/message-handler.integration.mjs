import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.env.RUN_DB_INTEGRATION !== 'true') {
  console.log('Teste de integração ignorado. Use RUN_DB_INTEGRATION=true para executá-lo.')
  process.exit(0)
}

// Estes identificadores são exclusivamente sintéticos e nunca devem representar
// uma conta real. A configuração é aplicada antes dos imports do bot.
const runId = String(Date.now())
const phoneSuffix = runId.slice(-10)
const fakePhone = `55${phoneSuffix}`
const unauthorizedPhone = `56${phoneSuffix}`
const fakeLid = `integration-${runId}@lid`
const mappedLid = `integration-mapped-${runId}@lid`
const unauthorizedLid = `integration-unauthorized-${runId}@lid`
const fakePnJid = `${fakePhone}@s.whatsapp.net`
const unauthorizedPnJid = `${unauthorizedPhone}@s.whatsapp.net`
process.env.ADMIN_NUMBERS = fakePhone
process.env.SPAM_WINDOW_MS = '0'
process.env.IGNORE_OLD_MESSAGES = 'true'

const buildDir = resolve(process.env.FIRABOT_BUILD_DIR || 'dist')
const fromBuild = (relativePath) => pathToFileURL(resolve(buildDir, relativePath)).href

const [{ messageHandler }, { config }, { closeDatabasePool, upsertUserIdentity }] = await Promise.all([
  import(fromBuild('middlewares/messageHandler.js')),
  import(fromBuild('config.js')),
  import(fromBuild('functions/database.js'))
])

const allowedLocalHosts = new Set(['127.0.0.1', 'localhost'])
if (!allowedLocalHosts.has(config.database.host || '')) {
  throw new Error('Teste de integração recusado: DB_HOST deve apontar para o MySQL local.')
}

const connection = await mysql.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  charset: 'utf8mb4'
})

const syntheticJids = [fakeLid, mappedLid, unauthorizedLid, fakePnJid, unauthorizedPnJid]
const syntheticPhones = [fakePhone, unauthorizedPhone]
const jidPlaceholders = syntheticJids.map(() => '?').join(', ')
const phonePlaceholders = syntheticPhones.map(() => '?').join(', ')
const [collisions] = await connection.execute(
  `SELECT id
     FROM users
    WHERE phone_number IN (${jidPlaceholders})
       OR whatsapp_jid IN (${jidPlaceholders})
       OR phone_e164 IN (${phonePlaceholders})
    LIMIT 1`,
  [...syntheticJids, ...syntheticJids, ...syntheticPhones]
)

if (collisions.length > 0) {
  await connection.end()
  await closeDatabasePool()
  throw new Error('Teste de integração recusado: os identificadores sintéticos colidem com dados existentes.')
}

const sentMessages = []
const socket = {
  signalRepository: {
    lidMapping: {
      async getPNForLID(lid) {
        return lid === mappedLid ? fakePnJid : undefined
      }
    }
  },
  sendMessage: async (jid, content) => {
    sentMessages.push({ jid, content })
    return { key: { id: `out-${sentMessages.length}` } }
  }
}

const createMessage = (text, id, remoteJid = fakeLid, alternateJid = fakePnJid) => ({
  key: {
    id,
    remoteJid,
    ...(alternateJid ? { remoteJidAlt: alternateJid } : {}),
    fromMe: false
  },
  pushName: 'Usuário de Integração',
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: text }
})

async function send(text, id, remoteJid = fakeLid, alternateJid = fakePnJid) {
  await messageHandler(socket, { messages: [createMessage(text, id, remoteJid, alternateJid)] }, {
    startedAt: Math.floor(Date.now() / 1000) - 1
  })
}

try {
  await upsertUserIdentity(fakeLid, 'Usuário de Integração', [fakePnJid])
  await send('!ping', 'integration-ping', fakeLid, null)
  assert.match(sentMessages.at(-1)?.content?.text || '', /Firabot está ativo/i)

  await send('!ping', 'integration-ping-lid-mapping', mappedLid, null)
  assert.match(sentMessages.at(-1)?.content?.text || '', /Firabot está ativo/i)

  await send('!status', 'integration-status')
  assert.match(sentMessages.at(-1)?.content?.text || '', /STATUS DO FIRABOT/)
  assert.match(sentMessages.at(-1)?.content?.text || '', /Banco: connected/)
  assert.match(sentMessages.at(-1)?.content?.text || '', /Documentos ativos no banco: \d+/)

  await send('!status', 'integration-status-forbidden', unauthorizedLid, unauthorizedPnJid)
  assert.match(sentMessages.at(-1)?.content?.text || '', /403/)
  assert.doesNotMatch(sentMessages.at(-1)?.content?.text || '', /STATUS DO FIRABOT/)

  await send('oi', 'integration-greeting')
  assert.ok(sentMessages.some(item => /assistente virtual/i.test(item.content?.text || '')))
  assert.ok(sentMessages.some(item => /1 - Biblioteca/.test(item.content?.text || '')))

  await send('2', 'integration-docs')
  assert.match(sentMessages.at(-1)?.content?.text || '', /Documentos DRCA/i)

  const [users] = await connection.execute(
    'SELECT id, full_name, whatsapp_jid, phone_e164 FROM users WHERE phone_number = ? LIMIT 1',
    [fakeLid]
  )
  assert.equal(users.length, 1)
  assert.equal(users[0].full_name, 'Usuário de Integração')
  assert.equal(users[0].whatsapp_jid, fakeLid)
  assert.equal(users[0].phone_e164, fakePhone)

  const [states] = await connection.execute(
    `SELECT us.state
       FROM user_states us
       JOIN users u ON u.id = us.user_id
      WHERE u.phone_number = ?`,
    [fakeLid]
  )
  assert.equal(states[0]?.state, 'docs')

  const originalUserId = users[0].id
  const userIdFromPhoneJid = await upsertUserIdentity(fakePnJid, 'Usuário Atualizado', [fakeLid])
  assert.equal(userIdFromPhoneJid, originalUserId)

  const [updatedUsers] = await connection.execute(
    'SELECT full_name FROM users WHERE id = ? LIMIT 1',
    [originalUserId]
  )
  assert.equal(updatedUsers[0]?.full_name, 'Usuário Atualizado')

  const [identityCount] = await connection.execute(
    'SELECT COUNT(*) AS total FROM users WHERE phone_number IN (?, ?)',
    [fakeLid, fakePnJid]
  )
  assert.equal(Number(identityCount[0]?.total), 1)

  console.log('Integração messageHandler + MySQL passou: !ping/!status, 403, LID/PN, identidade única, saudação e estado docs.')
} finally {
  await connection.execute(
    'DELETE FROM users WHERE phone_number IN (?, ?, ?)',
    [fakeLid, mappedLid, unauthorizedLid]
  )
  await connection.end()
  await closeDatabasePool()
}
