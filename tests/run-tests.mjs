import assert from 'node:assert/strict'
import path from 'node:path'
import {
  isGreetingOrStartMessage,
  isMessageFromBeforeStart,
  isPrefixedCommand
} from '../dist/services/messageGuardService.js'
import { getMenuRouteForOption, shouldCaptureSupportMessage } from '../dist/services/menuRoutingService.js'
import { canSafelyRouteNumericInput, isStateExpiredWithTtl, normalizeUserState } from '../dist/services/userStateService.js'
import {
  getAdminCommandDenial,
  getValidAdminNumbers,
  isAdminMessageAuthorized,
  isAdminNumberAuthorized,
  normalizeAdminNumber,
  resolveAdminAuthorization
} from '../dist/services/adminAuthService.js'
import { botLog, maskPhone, resolveEventResultCode } from '../dist/services/logService.js'
import { BotResultCode } from '../dist/types/resultCode.js'
import { formatCourseMenu, formatMainMenu, formatMenu } from '../dist/services/menuService.js'
import { formatDocumentSuccessMessage, resolveSafeDocumentPath, sendDocument } from '../dist/services/documentService.js'
import { extractMessageText } from '../dist/services/messageTextService.js'
import { docsCategoryMenu } from '../dist/menus/docsMenu.js'
import { getPpcCategoryCodeByState } from '../dist/menus/courseMenu.js'
import { formatOpenNoticesMessage, openNotices } from '../dist/menus/noticesMenu.js'
import { formatContextualFollowUpMessage, getRemainingMenuOptions } from '../dist/services/followUpMenuService.js'
import { cancelPendingFollowUp, sendFollowUp, sendUnknownMessage } from '../dist/flows/conversationFlow.js'
import { formatSupportAcknowledgement, formatSupportPrompt, sanitizeSupportMessage } from '../dist/flows/supportFlow.js'
import { detectConversationIntent } from '../dist/services/conversationIntentService.js'
import { getMessageJidCandidates, getPhoneE164FromJids } from '../dist/services/userIdentityService.js'
import {
  clearProcessedMessageIds,
  processMessageBatch,
  shouldProcessMessageId
} from '../dist/services/messageBatchService.js'
import { prepareLogMessageStorage } from '../dist/functions/database.js'
import { formatStatusMessage } from '../dist/commands/status.js'
import pingCommand from '../dist/commands/ping.js'
import ifmaCommand from '../dist/commands/ifma.js'
import oiCommand from '../dist/commands/oi.js'
import {
  createReconnectScheduler,
  getDisconnectStatusCode,
  getReconnectDecision
} from '../dist/services/connectionPolicyService.js'
import { processCommand } from '../dist/handlers/commandHandler.js'

function runTest(name, testFn) {
  const result = testFn()
  if (result && typeof result.then === 'function') {
    throw new Error(`Teste assíncrono chamado sem await: ${name}`)
  }
  console.log(`ok - ${name}`)
}

async function runAsyncTest(name, testFn) {
  await testFn()
  console.log(`ok - ${name}`)
}

function createFakeSocket() {
  const messages = []
  return {
    messages,
    sock: {
      async sendMessage(jid, content) {
        messages.push({ jid, content })
      }
    }
  }
}

function createCommandDependencies(overrides = {}) {
  const events = []
  return {
    events,
    dependencies: {
      commandRegistry: new Map(),
      ensureCommandsReady: async () => {},
      sendEnd: async (...args) => events.push({ type: 'end', args }),
      sendStart: async (...args) => events.push({ type: 'start', args }),
      authorizeAdmin: async () => ({
        authorized: true,
        source: 'message',
        lidMappingAttempted: false,
        databaseLookupAttempted: false
      }),
      getAdminDenial: () => ({
        adminsConfigured: true,
        code: BotResultCode.FORBIDDEN,
        message: 'negado 403'
      }),
      writeTechnicalLog: (...args) => events.push({ type: 'technical-log', args }),
      writeUserLog: async (...args) => events.push({ type: 'user-log', args }),
      resolveJidDomain: () => 's.whatsapp.net',
      ...overrides
    }
  }
}

runTest('decide reconexão apenas quando a sessão não foi encerrada', () => {
  const loggedOutError = { output: { statusCode: 401 } }
  const transientError = { output: { statusCode: 408 } }

  assert.equal(getDisconnectStatusCode(loggedOutError), 401)
  assert.equal(getDisconnectStatusCode({ output: { statusCode: '401' } }), undefined)
  assert.deepEqual(getReconnectDecision(loggedOutError, 401), {
    reason: 401,
    shouldReconnect: false,
    runtimeStatus: 'logged_out'
  })
  assert.deepEqual(getReconnectDecision(transientError, 401), {
    reason: 408,
    shouldReconnect: true,
    runtimeStatus: 'disconnected'
  })
  assert.deepEqual(getReconnectDecision(undefined, 401), {
    reason: undefined,
    shouldReconnect: true,
    runtimeStatus: 'disconnected'
  })
})

runTest('agendador mantém timer único e permite cancelar reconexão pendente', () => {
  const scheduled = []
  const cleared = []
  const scheduler = createReconnectScheduler({
    delayMs: 5_000,
    reconnect: async () => {},
    onReconnectError: () => {},
    setTimer: (callback, delayMs) => {
      const handle = { callback, delayMs }
      scheduled.push(handle)
      return handle
    },
    clearTimer: handle => cleared.push(handle)
  })

  scheduler.schedule()
  scheduler.schedule()
  assert.equal(scheduled.length, 1)
  assert.equal(scheduler.hasPending(), true)

  scheduler.cancel()
  assert.deepEqual(cleared, [scheduled[0]])
  assert.equal(scheduler.hasPending(), false)
})

await runAsyncTest('comandos ping, ifma e oi enviam respostas ao remetente', async () => {
  const ping = createFakeSocket()
  const ifma = createFakeSocket()
  const oi = createFakeSocket()
  const msg = { key: { remoteJid: 'user@s.whatsapp.net' } }

  await pingCommand.execute(ping.sock, msg)
  await ifmaCommand.execute(ifma.sock, msg)
  await oiCommand.execute(oi.sock, msg)

  assert.deepEqual(ping.messages, [{
    jid: 'user@s.whatsapp.net',
    content: { text: 'O Firabot está ativo!' }
  }])
  assert.equal(ifma.messages.length, 1)
  assert.equal(ifma.messages[0].jid, 'user@s.whatsapp.net')
  assert.match(ifma.messages[0].content.text, /INFORMAÇÕES IFMA/)
  assert.match(ifma.messages[0].content.text, /Calendário Acadêmico/)
  assert.equal(oi.messages[0].jid, 'user@s.whatsapp.net')
  assert.match(oi.messages[0].content.text, /ASSISTENTE IFMA/)
})

await runAsyncTest('dispatcher encaminha encerramento e aliases de início sem consultar comandos', async () => {
  const { sock } = createFakeSocket()
  let commandLookups = 0
  const fixture = createCommandDependencies({
    ensureCommandsReady: async () => { commandLookups += 1 }
  })
  const msg = { key: { remoteJid: 'user@s.whatsapp.net' } }

  await processCommand(sock, msg, '!encerrar', 'user@s.whatsapp.net', 'Aluno', 'docs', fixture.dependencies)
  await processCommand(sock, msg, '!menu', 'user@s.whatsapp.net', 'Aluno', 'main', fixture.dependencies)

  assert.deepEqual(fixture.events.map(event => event.type), ['end', 'start'])
  assert.equal(fixture.events[1].args[3], 'Início: !menu')
  assert.equal(commandLookups, 0)
})

await runAsyncTest('dispatcher executa comando público com argumentos e registra sucesso', async () => {
  const { sock } = createFakeSocket()
  const receivedArgs = []
  const fixture = createCommandDependencies({
    commandRegistry: new Map([['eco', {
      name: 'eco',
      description: 'Eco de teste',
      execute: async (_sock, _msg, args) => receivedArgs.push(...args)
    }]])
  })

  await processCommand(
    sock,
    { key: { remoteJid: 'user@s.whatsapp.net' } },
    '!eco um dois',
    'user@s.whatsapp.net',
    'Aluno',
    'main',
    fixture.dependencies
  )

  assert.deepEqual(receivedArgs, ['um', 'dois'])
  assert.equal(fixture.events.at(-1).type, 'user-log')
})

await runAsyncTest('dispatcher bloqueia comando administrativo com 403 ou 503', async () => {
  for (const denial of [
    { adminsConfigured: true, code: BotResultCode.FORBIDDEN, message: 'negado 403' },
    { adminsConfigured: false, code: BotResultCode.SERVICE_UNAVAILABLE, message: 'indisponível 503' }
  ]) {
    const { sock, messages } = createFakeSocket()
    let executions = 0
    const fixture = createCommandDependencies({
      commandRegistry: new Map([['restrito', {
        name: 'restrito',
        description: 'Restrito de teste',
        adminOnly: true,
        execute: async () => { executions += 1 }
      }]]),
      authorizeAdmin: async () => ({
        authorized: false,
        source: 'none',
        lidMappingAttempted: true,
        databaseLookupAttempted: true
      }),
      getAdminDenial: () => denial
    })

    await processCommand(
      sock,
      { key: { remoteJid: 'user@lid' } },
      '!restrito',
      'user@lid',
      'Aluno',
      'main',
      fixture.dependencies
    )

    assert.equal(executions, 0)
    assert.equal(messages[0].content.text, denial.message)
    assert.equal(fixture.events.some(event => event.type === 'technical-log'), true)
    assert.equal(fixture.events.some(event => event.type === 'user-log'), true)
  }
})

await runAsyncTest('dispatcher autoriza comando administrativo e rejeita comando desconhecido', async () => {
  const authorized = createCommandDependencies({
    commandRegistry: new Map([['restrito', {
      name: 'restrito',
      description: 'Restrito de teste',
      adminOnly: true,
      execute: async () => authorized.events.push({ type: 'execute' })
    }]])
  })
  const authorizedSocket = createFakeSocket()

  await processCommand(
    authorizedSocket.sock,
    { key: { remoteJid: 'admin@s.whatsapp.net' } },
    '!restrito',
    'admin@s.whatsapp.net',
    'Admin',
    'main',
    authorized.dependencies
  )

  assert.deepEqual(authorized.events.map(event => event.type), ['execute', 'technical-log', 'user-log'])

  const unknown = createCommandDependencies()
  const unknownSocket = createFakeSocket()
  await processCommand(
    unknownSocket.sock,
    { key: { remoteJid: 'user@s.whatsapp.net' } },
    '!',
    'user@s.whatsapp.net',
    'Aluno',
    'main',
    unknown.dependencies
  )

  assert.match(unknownSocket.messages[0].content.text, /404/)
  assert.equal(unknown.events.at(-1).type, 'user-log')
})

await runAsyncTest('processa todas as mensagens de um upsert na ordem recebida', async () => {
  const processed = []
  const messages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  await processMessageBatch(messages, async message => {
    processed.push(message.id)
  })

  assert.deepEqual(processed, ['a', 'b', 'c'])
})

await runAsyncTest('isola erro de uma mensagem sem perder o restante do lote', async () => {
  const processed = []
  const errors = []

  await processMessageBatch(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    async message => {
      if (message.id === 'b') throw new Error('falha controlada')
      processed.push(message.id)
    },
    async (error, message) => {
      errors.push({ error: error.message, id: message.id })
    }
  )

  assert.deepEqual(processed, ['a', 'c'])
  assert.deepEqual(errors, [{ error: 'falha controlada', id: 'b' }])
})

runTest('bloqueia ID duplicado durante a janela de deduplicação', () => {
  clearProcessedMessageIds()

  assert.equal(shouldProcessMessageId('message-1', 1_000, 10_000), true)
  assert.equal(shouldProcessMessageId('message-1', 2_000, 10_000), false)
  assert.equal(shouldProcessMessageId('message-1', 11_001, 10_000), true)
})

runTest('persiste apenas preview minimizado nos logs de atendimento', () => {
  const content = `  ${'mensagem sensível '.repeat(30)}  `
  const stored = prepareLogMessageStorage(content)

  assert.equal(stored.legacyMessage, '')
  assert.equal(stored.messagePreview.length, 255)
  assert.equal(stored.messagePreview.startsWith('mensagem sensível'), true)
})

runTest('aceita mensagens sem ID e remove IDs expirados do cache', () => {
  clearProcessedMessageIds()

  assert.equal(shouldProcessMessageId(undefined, 1_000, 10_000), true)
  assert.equal(shouldProcessMessageId('expired', 1_000, 10_000), true)
  assert.equal(shouldProcessMessageId('current', 20_000, 10_000), true)
  assert.equal(shouldProcessMessageId('expired', 20_001, 10_000), true)
})

runTest('detecta saudações e mensagens de início sem prefixo', () => {
  assert.equal(isGreetingOrStartMessage('oi'), true)
  assert.equal(isGreetingOrStartMessage('Olá!'), true)
  assert.equal(isGreetingOrStartMessage('bom dia'), true)
  assert.equal(isGreetingOrStartMessage('menu'), true)
  assert.equal(isGreetingOrStartMessage('qual é o horário?'), false)
})

runTest('detecta comandos com prefixo', () => {
  assert.equal(isPrefixedCommand('!ping'), true)
  assert.equal(isPrefixedCommand('!help'), true)
  assert.equal(isPrefixedCommand('ping'), false)
})

runTest('extrai texto de mensagens comuns e captions', () => {
  assert.equal(extractMessageText({ conversation: 'oi' }), 'oi')
  assert.equal(extractMessageText({ extendedTextMessage: { text: 'menu' } }), 'menu')
  assert.equal(extractMessageText({ imageMessage: { caption: 'documento' } }), 'documento')
})

runTest('identifica mensagens anteriores ao início do bot', () => {
  assert.equal(isMessageFromBeforeStart(99, 100), true)
  assert.equal(isMessageFromBeforeStart(100, 100), false)
  assert.equal(isMessageFromBeforeStart(101, 100), false)
})

runTest('mantém docs roteando para seleção de setor', () => {
  assert.equal(getMenuRouteForOption('docs', '1'), 'docs')
  assert.equal(getMenuRouteForOption('docs', '2'), 'docs')
  assert.equal(getMenuRouteForOption('docs', '3'), 'docs')
})

runTest('mantém docs_drca e docs_cae no roteamento certo', () => {
  assert.equal(getMenuRouteForOption('docs_drca', '1'), 'docs_drca')
  assert.equal(getMenuRouteForOption('docs_drca', '3'), 'docs_drca')
  assert.equal(getMenuRouteForOption('docs_cae', '1'), 'docs_cae')
  assert.equal(getMenuRouteForOption('docs_cae', '2'), 'docs_cae')
})

runTest('mantém curso roteando para seleção de curso', () => {
  assert.equal(getMenuRouteForOption('curso', '1'), 'curso')
  assert.equal(getMenuRouteForOption('curso', '2'), 'curso')
  assert.equal(getMenuRouteForOption('curso', '4'), 'curso')
})

runTest('captura mensagem numérica no suporte sem confundir com menu', () => {
  assert.equal(shouldCaptureSupportMessage('suporte', '123456'), true)
  assert.equal(shouldCaptureSupportMessage('suporte', 'protocolo 123'), true)
  assert.equal(shouldCaptureSupportMessage('suporte', '0'), false)
  assert.equal(shouldCaptureSupportMessage('main', '123456'), false)
})

runTest('mantém estados de PPC por curso no roteamento certo', () => {
  assert.equal(getMenuRouteForOption('curso_eng_comp', '1'), 'curso_eng_comp')
  assert.equal(getMenuRouteForOption('curso_eng_comp', '2'), 'curso_eng_comp')
  assert.equal(getMenuRouteForOption('curso_bach_adm', '1'), 'curso_bach_adm')
  assert.equal(getMenuRouteForOption('curso_lic_fis', '2'), 'curso_lic_fis')
  assert.equal(getMenuRouteForOption('curso_grad_tce', '1'), 'curso_grad_tce')
  assert.equal(getMenuRouteForOption('curso_eng_civil', '1'), 'curso_eng_civil')
})

runTest('volta para o menu principal com zero em qualquer submenu', () => {
  assert.equal(getMenuRouteForOption('docs', '0'), 'main')
  assert.equal(getMenuRouteForOption('curso', '0'), 'main')
})

runTest('menu principal segue o novo modelo numerado sem opção zero', () => {
  const menu = formatMainMenu()
  assert.match(menu, /1 - Biblioteca/)
  assert.match(menu, /5 - Editais Abertos/)
  assert.match(menu, /6 - RU/)
  assert.match(menu, /7 - Suporte/)
  assert.doesNotMatch(menu, /0 - Voltar/)
})

runTest('menu de PPC lista cursos com documentos cadastrados', () => {
  const menu = formatCourseMenu()
  assert.match(menu, /1 - Engenharia de Computação/)
  assert.match(menu, /2 - Bacharelado em Administração/)
  assert.match(menu, /3 - Licenciatura em Física/)
  assert.match(menu, /4 - Tecnologia em Construção de Edifícios/)
  assert.match(menu, /5 - Engenharia Civil/)
  assert.match(menu, /0 - Voltar ao Menu Principal/)
})

runTest('menu de documentos por setor lista DRCA e CAE', () => {
  const menu = formatMenu(docsCategoryMenu)
  assert.match(menu, /1 - Documentos DRCA/)
  assert.match(menu, /2 - Documentos CAE/)
  assert.match(menu, /0 - Voltar ao Menu Principal/)
})

runTest('normaliza novos estados informativos', () => {
  assert.equal(normalizeUserState('docs'), 'docs')
  assert.equal(normalizeUserState('biblioteca'), 'biblioteca')
  assert.equal(normalizeUserState('docs_drca'), 'docs_drca')
  assert.equal(normalizeUserState('docs_cae'), 'docs_cae')
  assert.equal(normalizeUserState('curso'), 'curso')
  assert.equal(normalizeUserState('curso_eng_comp'), 'curso_eng_comp')
  assert.equal(normalizeUserState('curso_bach_adm'), 'curso_bach_adm')
  assert.equal(normalizeUserState('curso_lic_fis'), 'curso_lic_fis')
  assert.equal(normalizeUserState('curso_grad_tce'), 'curso_grad_tce')
  assert.equal(normalizeUserState('curso_eng_civil'), 'curso_eng_civil')
  assert.equal(normalizeUserState('links'), 'links')
  assert.equal(normalizeUserState('editais'), 'editais')
  assert.equal(normalizeUserState('ru'), 'ru')
  assert.equal(normalizeUserState('suporte'), 'suporte')
  assert.equal(normalizeUserState('suporte_confirmacao'), 'suporte_confirmacao')
  assert.equal(normalizeUserState('encerrado'), 'encerrado')
})

runTest('usa main como fallback para estado inválido', () => {
  assert.equal(normalizeUserState('estado-invalido'), 'main')
})

runTest('bloqueia opção numérica quando o estado não é confiável', () => {
  assert.equal(canSafelyRouteNumericInput({ state: 'main', source: 'database', databaseAvailable: true }), true)
  assert.equal(canSafelyRouteNumericInput({ state: 'docs', source: 'memory', databaseAvailable: false }), true)
  assert.equal(canSafelyRouteNumericInput({ state: 'main', source: 'default', databaseAvailable: false }), false)
})

runTest('detecta expiração de estado por TTL configurado', () => {
  const now = new Date('2026-05-17T12:00:00Z')

  assert.equal(isStateExpiredWithTtl(new Date('2026-05-17T10:59:00Z'), 60, now), true)
  assert.equal(isStateExpiredWithTtl(new Date('2026-05-17T11:30:00Z'), 60, now), false)
  assert.equal(isStateExpiredWithTtl(new Date('2026-05-16T12:00:00Z'), 0, now), false)
})

runTest('normaliza e autoriza números administrativos', () => {
  assert.equal(normalizeAdminNumber('+55 (98) 99999-9999@s.whatsapp.net'), '5598999999999')
  assert.equal(normalizeAdminNumber('5598999999999:12@s.whatsapp.net'), '5598999999999')
  assert.equal(isAdminNumberAuthorized('5598999999999@s.whatsapp.net', ['5598999999999']), true)
  assert.equal(isAdminNumberAuthorized('5598888888888@s.whatsapp.net', ['5598999999999']), false)
  assert.equal(isAdminNumberAuthorized('5598999999999@lid', ['5598999999999']), false)
})

runTest('descarta ADMIN_NUMBERS fora do formato E.164 plausível', () => {
  assert.deepEqual(getValidAdminNumbers([
    '123',
    '5598999999999',
    '+55 (98) 99999-9999',
    'abc5598999999999xyz',
    '5598999999999@g.us',
    '0000000000'
  ]), ['5598999999999'])
  assert.deepEqual(getValidAdminNumbers(['abc5598999999999xyz']), [])
  assert.deepEqual(getValidAdminNumbers(['5598999999999@g.us']), [])
  assert.deepEqual(getValidAdminNumbers(['0000000000']), [])
  assert.equal(isAdminNumberAuthorized('123@s.whatsapp.net', ['123']), false)
})

runTest('diferencia negação administrativa 403 de configuração ausente 503', () => {
  assert.equal(getAdminCommandDenial(['5598999999999']).code, BotResultCode.FORBIDDEN)
  assert.match(getAdminCommandDenial(['5598999999999']).message, /403/)
  assert.equal(getAdminCommandDenial(['123', 'inválido']).code, BotResultCode.SERVICE_UNAVAILABLE)
  assert.match(getAdminCommandDenial(['123', 'inválido']).message, /503/)
})

runTest('status não informa contagens zero quando o banco está indisponível', () => {
  const text = formatStatusMessage({
    runtime: {
      startedAt: new Date('2026-09-09T12:00:00Z'),
      whatsapp: 'connected',
      database: 'unavailable'
    },
    databaseOk: false,
    documentsHealth: null,
    environment: 'test',
    debug: false,
    botName: 'Firabot v7'
  })

  assert.match(text, /Banco: unavailable.*503/s)
  assert.match(text, /Documentos ativos no banco: indisponível/)
  assert.match(text, /Status dos documentos: indisponível/)
  assert.doesNotMatch(text, /Documentos ativos no banco: 0/)
})

await runAsyncTest('resolve administrador por mapeamento LID do socket', async () => {
  const sock = {
    signalRepository: {
      lidMapping: {
        async getPNForLID(lid) {
          assert.equal(lid, '123456789012345@lid')
          return '5598999999999:7@s.whatsapp.net'
        }
      }
    }
  }
  const result = await resolveAdminAuthorization(
    sock,
    { key: { remoteJid: '123456789012345@lid' } },
    ['5598999999999']
  )
  assert.deepEqual(result, {
    authorized: true,
    source: 'lid_mapping',
    lidMappingAttempted: true,
    databaseLookupAttempted: false
  })
})

await runAsyncTest('resolve administrador pela identidade persistida quando o mapa LID está vazio', async () => {
  const sock = {
    signalRepository: {
      lidMapping: {
        async getPNForLID() {
          return undefined
        }
      }
    }
  }
  const result = await resolveAdminAuthorization(
    sock,
    { key: { remoteJid: '123456789012345@lid' } },
    ['5598999999999'],
    async () => '5598999999999'
  )
  assert.deepEqual(result, {
    authorized: true,
    source: 'database',
    lidMappingAttempted: true,
    databaseLookupAttempted: true
  })
})

runTest('autoriza administrador por PN alternativo quando a conversa usa LID', () => {
  const message = {
    key: {
      remoteJid: '123456789012345@lid',
      remoteJidAlt: '5598999999999@s.whatsapp.net'
    }
  }

  assert.deepEqual(getMessageJidCandidates(message), [
    '123456789012345@lid',
    '5598999999999@s.whatsapp.net'
  ])
  assert.equal(getPhoneE164FromJids(getMessageJidCandidates(message)), '5598999999999')
  assert.equal(isAdminMessageAuthorized(message, ['5598999999999']), true)
})

runTest('reconhece apenas intenções conversacionais fechadas', () => {
  assert.equal(detectConversationIntent('quero documentos'), 'documents')
  assert.equal(detectConversationIntent('quero documento'), 'documents')
  assert.equal(detectConversationIntent('PPC'), 'course')
  assert.equal(detectConversationIntent('falar com suporte'), 'support')
  assert.equal(detectConversationIntent('voltar'), 'main')
  assert.equal(detectConversationIntent('sair'), 'end')
  assert.equal(detectConversationIntent('minha matrícula é 123'), null)
})

runTest('mascara telefone em logs técnicos', () => {
  assert.equal(maskPhone('5599999999999'), '5599****99')
})

runTest('mapeia eventos para códigos operacionais consistentes', () => {
  assert.equal(resolveEventResultCode('DOCUMENT_SENT'), BotResultCode.OK)
  assert.equal(resolveEventResultCode('INVALID_OPTION'), BotResultCode.BAD_REQUEST)
  assert.equal(resolveEventResultCode('COMMAND_DENIED'), BotResultCode.FORBIDDEN)
  assert.equal(resolveEventResultCode('COMMAND_UNKNOWN'), BotResultCode.NOT_FOUND)
  assert.equal(resolveEventResultCode('RATE_LIMITED'), BotResultCode.TOO_MANY_REQUESTS)
  assert.equal(resolveEventResultCode('DATABASE_UNAVAILABLE'), BotResultCode.SERVICE_UNAVAILABLE)
})

runTest('log técnico inclui código e correlação no envelope', () => {
  const originalLog = console.log
  const outputs = []
  console.log = value => outputs.push(String(value))

  try {
    botLog('MESSAGE_RECEIVED', 'Teste de envelope', { correlationId: 'message-123' })
  } finally {
    console.log = originalLog
  }

  const payload = JSON.parse(outputs[0])
  assert.equal(payload.code, 200)
  assert.equal(payload.correlationId, 'message-123')
  assert.equal(payload.service, 'firabot')
})

runTest('sanitiza conteúdo sensível em logs técnicos', () => {
  const originalLog = console.log
  const outputs = []
  console.log = value => outputs.push(String(value))

  try {
    botLog('MESSAGE_RECEIVED', 'Teste de sanitização', {
      user: '5599999999999@s.whatsapp.net',
      body: 'meu cpf é 00000000000',
      password: 'senha-secreta',
      token: 'token-secreto'
    })
  } finally {
    console.log = originalLog
  }

  const payload = outputs.join('\n')
  assert.match(payload, /5599\*\*\*\*99/)
  assert.match(payload, /\[USER_CONTENT_REDACTED:/)
  assert.doesNotMatch(payload, /00000000000/)
  assert.doesNotMatch(payload, /senha-secreta/)
  assert.doesNotMatch(payload, /token-secreto/)
})

runTest('sanitiza dados sensíveis dentro de objetos aninhados', () => {
  const originalLog = console.log
  const outputs = []
  console.log = value => outputs.push(String(value))

  try {
    botLog('MESSAGE_RECEIVED', 'Teste aninhado', {
      details: {
        token: 'token-aninhado',
        body: 'conteúdo privado',
        nested: { password: 'senha-aninhada' }
      }
    })
  } finally {
    console.log = originalLog
  }

  const payload = outputs.join('\n')
  assert.doesNotMatch(payload, /token-aninhado/)
  assert.doesNotMatch(payload, /conteúdo privado/)
  assert.doesNotMatch(payload, /senha-aninhada/)
})

runTest('mensagem de sucesso de documento inclui resumo quando disponível', () => {
  const message = formatDocumentSuccessMessage({
    key: '1',
    label: 'Documento de teste',
    path: './documentos/teste.pdf',
    summary: 'Serve para orientar o estudante sobre este documento.'
  })

  assert.match(message, /Documento enviado com sucesso\./)
  assert.match(message, /Resumo: Serve para orientar/)
})

runTest('protege resolução de documentos contra path traversal', () => {
  assert.equal(resolveSafeDocumentPath('drca/requerimento-academico.pdf').isInsideDocumentsDir, true)
  assert.equal(resolveSafeDocumentPath('./documentos/drca/requerimento-academico.pdf').isInsideDocumentsDir, true)
  assert.equal(resolveSafeDocumentPath('../.env').isInsideDocumentsDir, false)
  assert.equal(resolveSafeDocumentPath(path.resolve('package.json')).isInsideDocumentsDir, false)
})

await runAsyncTest('não envia documento com caminho fora de DOCUMENTS_DIR', async () => {
  const { sock, messages } = createFakeSocket()
  const originalLog = console.log
  const originalError = console.error
  console.log = () => {}
  console.error = () => {}

  let result
  try {
    result = await sendDocument(sock, 'user@s.whatsapp.net', {
      key: 'x',
      label: 'Arquivo proibido',
      path: '../.env'
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  assert.equal(result.success, false)
  assert.equal(result.code, BotResultCode.FORBIDDEN)
  assert.match(result.errorMessage, /fora da pasta permitida/)
  assert.equal(messages.length, 1)
  assert.match(messages[0].content.text, /caminho do arquivo está inválido/)
})

runTest('follow-up contextual mostra opções restantes do mesmo menu', () => {
  const options = [
    { key: '1', label: 'Requerimento Acadêmico' },
    { key: '2', label: 'Requerimento Diploma Técnico' },
    { key: '3', label: 'Requerimento Superior' },
    { key: '4', label: 'Termo de Desistência' }
  ]

  const remainingOptions = getRemainingMenuOptions(options, '1')
  const message = formatContextualFollowUpMessage(options, '1')

  assert.deepEqual(remainingOptions.map(option => option.key), ['2', '3', '4'])
  assert.doesNotMatch(message, /1 - Requerimento Acadêmico/)
  assert.match(message, /2 - Requerimento Diploma Técnico/)
  assert.match(message, /3 - Requerimento Superior/)
  assert.match(message, /4 - Termo de Desistência/)
  assert.match(message, /0 - Voltar ao Menu Principal/)
  assert.match(message, /encerrar - Terminar conversa/)
})

runTest('mapeia categorias de PPC para carregamento dinâmico futuro', () => {
  assert.equal(getPpcCategoryCodeByState('curso_eng_comp'), 'ppc_eng_comp')
  assert.equal(getPpcCategoryCodeByState('curso_bach_adm'), 'ppc_bach_adm')
  assert.equal(getPpcCategoryCodeByState('curso_lic_fis'), 'ppc_lic_fis')
  assert.equal(getPpcCategoryCodeByState('curso_grad_tce'), 'ppc_grad_tce')
  assert.equal(getPpcCategoryCodeByState('curso_eng_civil'), 'ppc_eng_civil')
})

runTest('mensagens do suporte orientam envio e confirmação', () => {
  assert.match(formatSupportPrompt(), /Descreva sua dúvida ou solicitação/)
  assert.match(formatSupportPrompt(), /não envie senha/i)
  assert.match(formatSupportAcknowledgement(), /Sua mensagem foi registrada/)
  assert.doesNotMatch(sanitizeSupportMessage('senha: segredo e token=abc123'), /segredo|abc123/)
})

await runAsyncTest('cancela follow-up pendente quando chega nova interação', async () => {
  const { sock, messages } = createFakeSocket()
  void sendFollowUp(sock, 'cancelamento@s.whatsapp.net', 20)
  cancelPendingFollowUp('cancelamento@s.whatsapp.net')
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(messages.length, 0)
})

await runAsyncTest('lista editais do banco ou fallback local do IFMA', async () => {
  const message = await formatOpenNoticesMessage({ useDatabase: false })

  assert.equal(openNotices.length, 10)
  assert.match(message, /Editais IFMA/)
  assert.match(message, /1\./)
  assert.match(message, /Fonte: https:\/\/processoseletivo\.ifma\.edu\.br\//)
})

await runAsyncTest('socket fake captura mensagem de fallback sem WhatsApp real', async () => {
  const { sock, messages } = createFakeSocket()
  await sendUnknownMessage(sock, 'user@s.whatsapp.net', 'main')

  assert.equal(messages.length, 1)
  assert.equal(messages[0].jid, 'user@s.whatsapp.net')
  assert.match(messages[0].content.text, /Não entendi essa mensagem/)
  assert.match(messages[0].content.text, /1 - Biblioteca/)
})

console.log('Todos os testes passaram.')
