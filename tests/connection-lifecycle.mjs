import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

export async function runConnectionLifecycleTests(test) {
  const lifecycleModule = await import('../dist/services/connectionLifecycleService.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
    throw error
  })
  const { createConnectionLifecycle, createGracefulShutdown } = lifecycleModule

  await test('lifecycle permite simular socket e encerrar recursos', () => {
    assert.equal(typeof createConnectionLifecycle, 'function')
    assert.equal(typeof createGracefulShutdown, 'function')
  })

  function deferred() {
    let resolve
    let reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  function fixture(overrides = {}) {
    const sockets = []
    const timers = new Map()
    const statuses = []
    const errors = []
    const messages = []
    let timerId = 0
    const dependencies = {
      prepare: async () => ({
        createSocket: () => {
          const sock = { ev: new EventEmitter(), ends: 0, end() { this.ends++ } }
          sockets.push(sock)
          return sock
        },
        saveCreds: async () => {}
      }),
      handleMessage: async (...args) => { messages.push(args) },
      setStatus: status => statuses.push(status),
      onEvent: () => {},
      onError: (...args) => { errors.push(args) },
      showQr: () => {},
      now: () => 1_700_000_000_000,
      setTimer: callback => { const id = ++timerId; timers.set(id, callback); return id },
      clearTimer: id => timers.delete(id),
      ...overrides
    }
    const lifecycle = createConnectionLifecycle({ reconnectDelayMs: 100, loggedOutReason: 401 }, dependencies)
    return { lifecycle, sockets, timers, statuses, errors, messages, dependencies,
      tick: async () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); await flush() }
    }
  }

  await test('lifecycle serializa inicio e usa timestamp de inicio para mensagens', async () => {
    const f = fixture()
    await Promise.all([f.lifecycle.start(), f.lifecycle.start(), f.lifecycle.start()])
    assert.equal(f.sockets.length, 1)
    const sock = f.sockets[0]
    sock.ev.emit('messages.upsert', { messages: [], type: 'notify' })
    await flush()
    assert.deepEqual(f.messages[0][2], { startedAt: 1_700_000_000 })
    await f.lifecycle.stop()
    assert.equal(sock.ends, 1)
    assert.equal(sock.ev.eventNames().length, 0)
  })

  await test('lifecycle descarta listeners antigos e ignora callbacks obsoletos', async () => {
    const f = fixture()
    await f.lifecycle.start()
    const old = f.sockets[0]
    const oldConnection = old.ev.listeners('connection.update')[0]
    const oldMessage = old.ev.listeners('messages.upsert')[0]
    old.ev.emit('connection.update', { connection: 'close' })
    assert.equal(old.ev.eventNames().length, 0)
    assert.equal(old.ends, 1)
    assert.equal(f.timers.size, 1)
    await f.tick()
    const current = f.sockets[1]
    current.ev.emit('connection.update', { connection: 'open' })
    oldConnection({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } })
    oldMessage({ messages: [], type: 'notify' })
    await flush()
    assert.equal(f.statuses.at(-1), 'connected')
    assert.equal(f.messages.length, 0)
    assert.equal(f.timers.size, 0)
    await f.lifecycle.start()
    assert.equal(f.sockets.length, 2)
    await f.lifecycle.stop()
  })

  await test('lifecycle loggedOut e terminal mesmo se start for chamado novamente', async () => {
    const f = fixture()
    await f.lifecycle.start()
    f.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } })
    await f.lifecycle.start()
    assert.equal(f.timers.size, 0)
    assert.equal(f.sockets.length, 1)
    assert.equal(f.statuses.at(-1), 'logged_out')
    await f.lifecycle.stop()
  })

  await test('lifecycle repete falha transitoria de inicializacao e cancela retry ao parar', async () => {
    let calls = 0
    const f = fixture({ prepare: async () => { calls++; throw new Error('provider unavailable') } })
    await f.lifecycle.start()
    assert.equal(f.timers.size, 1)
    await f.tick()
    assert.equal(calls, 2)
    assert.equal(f.timers.size, 1)
    await f.lifecycle.stop()
    assert.equal(f.timers.size, 0)
    await f.lifecycle.start()
    assert.equal(calls, 2)
  })

  await test('stop durante prepare nao cria socket nem rearma retry ao rejeitar', async () => {
    for (const reject of [false, true]) {
      const prepare = deferred()
      const f = fixture({ prepare: () => prepare.promise })
      const starting = f.lifecycle.start()
      const stopping = f.lifecycle.stop()
      if (reject) prepare.reject(new Error('provider unavailable'))
      else prepare.resolve(await fixture().dependencies.prepare())
      await Promise.all([starting, stopping])
      assert.equal(f.sockets.length, 0)
      assert.equal(f.timers.size, 0)
      assert.equal(f.statuses.at(-1), 'disconnected')
    }
  })

  await test('stop drena mensagens e creds e trata rejeicoes assincronas', async () => {
    const message = deferred()
    const creds = deferred()
    const f = fixture({ handleMessage: () => message.promise })
    const original = f.dependencies.prepare
    f.dependencies.prepare = async () => ({ ...await original(), saveCreds: () => creds.promise })
    await f.lifecycle.start()
    const sock = f.sockets[0]
    sock.ev.emit('messages.upsert', { messages: [], type: 'notify' })
    sock.ev.emit('creds.update', {})
    let stopped = false
    const stopping = f.lifecycle.stop().then(() => { stopped = true })
    await flush()
    assert.equal(stopped, false)
    assert.equal(sock.ends, 0)
    assert.equal(sock.ev.eventNames().length, 0)
    message.resolve()
    creds.reject(new Error('disk unavailable'))
    await stopping
    assert.equal(sock.ends, 1)
    assert.equal(f.errors.length, 1)
  })

  await test('persistencia de creds e serial entre eventos do mesmo socket', async () => {
    const first = deferred()
    const second = deferred()
    const started = []
    const f = fixture()
    const original = f.dependencies.prepare
    f.dependencies.prepare = async () => ({
      ...await original(),
      saveCreds: () => {
        started.push(started.length + 1)
        return started.length === 1 ? first.promise : second.promise
      }
    })

    await f.lifecycle.start()
    const sock = f.sockets[0]
    sock.ev.emit('creds.update', {})
    sock.ev.emit('creds.update', {})
    await flush()
    assert.deepEqual(started, [1])

    first.resolve()
    await flush()
    assert.deepEqual(started, [1, 2])

    let stopped = false
    const stopping = f.lifecycle.stop().then(() => { stopped = true })
    await flush()
    assert.equal(stopped, false)
    second.resolve()
    await stopping
    assert.equal(sock.ends, 1)
  })

  await test('shutdown e idempotente, drena recursos antes do pool e possui prazo', async () => {
    const events = []
    const stop = deferred()
    let timeout
    const shutdown = createGracefulShutdown({
      stopBot: () => { events.push('stop'); return stop.promise },
      stopFollowUps: async () => { events.push('followups') },
      closeDatabase: async () => { events.push('pool') },
      onError: () => { events.push('error') },
      onTimeout: () => { events.push('timeout') },
      setTimer: callback => { timeout = callback; return 1 },
      clearTimer: () => { events.push('clear') }
    })
    const first = shutdown()
    const second = shutdown()
    assert.equal(first, second)
    await flush()
    assert.equal(events.includes('pool'), false)
    timeout()
    assert.equal(events.includes('timeout'), true)
    stop.resolve()
    await first
    assert.deepEqual(events, ['followups', 'stop', 'timeout', 'pool', 'clear'])
  })
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/connection-lifecycle.mjs')) {
  let total = 0
  await runConnectionLifecycleTests(async (name, run) => { await run(); total++; console.log(`OK ${name}`) })
  console.log(`${total} testes lifecycle aprovados`)
}
