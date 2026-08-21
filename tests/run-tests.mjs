import assert from 'node:assert/strict'
import path from 'node:path'
import {
  isGreetingOrStartMessage,
  isMessageFromBeforeStart,
  isPrefixedCommand
} from '../dist/services/messageGuardService.js'
import { getMenuRouteForOption, shouldCaptureSupportMessage } from '../dist/services/menuRoutingService.js'
import { isStateExpiredWithTtl, normalizeUserState } from '../dist/services/userStateService.js'
import { isAdminNumberAuthorized, normalizeAdminNumber } from '../dist/services/adminAuthService.js'
import { botLog, maskPhone } from '../dist/services/logService.js'
import { formatCourseMenu, formatMainMenu, formatMenu } from '../dist/services/menuService.js'
import { formatDocumentSuccessMessage, resolveSafeDocumentPath, sendDocument } from '../dist/services/documentService.js'
import { extractMessageText } from '../dist/services/messageTextService.js'
import { docsCategoryMenu } from '../dist/menus/docsMenu.js'
import { getPpcCategoryCodeByState } from '../dist/menus/courseMenu.js'
import { formatOpenNoticesMessage, openNotices } from '../dist/menus/noticesMenu.js'
import { formatContextualFollowUpMessage, getRemainingMenuOptions } from '../dist/services/followUpMenuService.js'
import { sendUnknownMessage } from '../dist/flows/conversationFlow.js'
import { formatSupportAcknowledgement, formatSupportPrompt } from '../dist/flows/supportFlow.js'

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

runTest('detecta expiração de estado por TTL configurado', () => {
  const now = new Date('2026-05-17T12:00:00Z')

  assert.equal(isStateExpiredWithTtl(new Date('2026-05-17T10:59:00Z'), 60, now), true)
  assert.equal(isStateExpiredWithTtl(new Date('2026-05-17T11:30:00Z'), 60, now), false)
  assert.equal(isStateExpiredWithTtl(new Date('2026-05-16T12:00:00Z'), 0, now), false)
})

runTest('normaliza e autoriza números administrativos', () => {
  assert.equal(normalizeAdminNumber('+55 (98) 99999-9999@s.whatsapp.net'), '5598999999999')
  assert.equal(isAdminNumberAuthorized('5598999999999@s.whatsapp.net', ['+55 (98) 99999-9999']), true)
  assert.equal(isAdminNumberAuthorized('5598888888888@s.whatsapp.net', ['5598999999999']), false)
})

runTest('mascara telefone em logs técnicos', () => {
  assert.equal(maskPhone('5599999999999'), '5599****99')
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
  assert.match(formatSupportAcknowledgement(), /Sua mensagem foi registrada/)
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
