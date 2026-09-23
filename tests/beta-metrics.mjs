import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createBetaMetricsAccumulator, betaMetricsMaxLineBytes } from '../dist/services/betaMetricsService.js'

const accumulator = createBetaMetricsAccumulator()
const events = [
  { eventType: 'MESSAGE_RECEIVED', context: { user: '15551234567@s.whatsapp.net', text: 'mensagem privada', stateBefore: 'main' } },
  { eventType: 'INVALID_OPTION', context: { stateBefore: 'docs' } },
  { eventType: 'DOCUMENT_SENT', context: { stateBefore: 'docs_cae', documentId: 'arquivo-confidencial' } },
  { eventType: 'DOCUMENT_ERROR', context: { stateBefore: 'curso' } },
  { eventType: 'BOT_RECONNECTING', context: { reason: 'connectionClosed' } },
  { eventType: 'USER_STATE_CHANGED', context: { stateBefore: 'main', stateAfter: 'encerrado' } },
  { eventType: 'MESSAGE_PROCESSED', context: { durationMs: 20, success: true } },
  { eventType: 'MESSAGE_PROCESSED', context: { durationMs: 90, success: false } },
  { eventType: 'MESSAGE_PROCESSED', context: { durationMs: 800, success: true } },
  { eventType: 'MESSAGE_PROCESSED', context: { durationMs: 4000, success: true } },
  { eventType: 'MESSAGE_PROCESSED', context: { durationMs: 61_000, success: true } },
  { eventType: 'MESSAGE_RECEIVED', context: { stateBefore: 'estado-inventado', user: 'jid-secreto', path: 'C:\\privado\\arquivo' } },
  { eventType: 'EVENTO_PRIVADO', context: { stateBefore: 'main', text: 'nao deve ser copiado' } }
]

for (const event of events) accumulator.consumeLine(JSON.stringify(event))
accumulator.consumeLine('{json quebrado')
accumulator.consumeOversizedLine()
accumulator.consumeLine(JSON.stringify({ eventType: 'MESSAGE_PROCESSED', context: { durationMs: -1 } }))
accumulator.consumeLine(JSON.stringify({ eventType: 'MESSAGE_PROCESSED', context: { durationMs: Number.MAX_VALUE } }))

const report = accumulator.snapshot()
assert.deepEqual(report.counts, {
  received: 2,
  invalidOption: 1,
  documentSent: 1,
  documentError: 1,
  reconnect: 1,
  end: 1,
  handlerDurationSamples: 5
})
assert.deepEqual(report.handlerDurationMs, {
  method: 'histogram-upper-bound',
  p50Approx: 1_000,
  p95Approx: 86_400_000,
  buckets: {
    '<=50ms': 1,
    '<=100ms': 1,
    '<=250ms': 0,
    '<=500ms': 0,
    '<=1s': 1,
    '<=2.5s': 0,
    '<=5s': 1,
    '<=10s': 0,
    '<=30s': 0,
    '<=60s': 0,
    '>60s (<=24h)': 1
  }
})
assert.equal(report.byState.main.received, 1)
assert.equal(report.byState.docs.invalidOption, 1)
assert.equal(report.byState.docs_cae.documentSent, 1)
assert.equal(report.byState.curso.documentError, 1)
assert.equal(report.byState.encerrado.end, 1)
assert.deepEqual(report.input, { malformedLines: 1, oversizedLines: 1 })

const serialized = JSON.stringify(report)
for (const secret of ['15551234567', 'mensagem privada', 'jid-secreto', 'C:\\privado', 'arquivo-confidencial', 'nao deve ser copiado']) {
  assert.equal(serialized.includes(secret), false, `relatorio nao deve conter ${secret}`)
}
assert.equal('completionRate' in report.counts, false)

const cliPath = fileURLToPath(new URL('../scripts/beta-report.mjs', import.meta.url))
const cli = spawn(process.execPath, [cliPath], { stdio: ['pipe', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
cli.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
cli.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
cli.stdin.write(`${JSON.stringify(events[0])}\n`)
cli.stdin.write(`${'{'.padEnd(betaMetricsMaxLineBytes + 5, 'x')}\n`)
cli.stdin.end(`${JSON.stringify(events[1])}\n`)
const [exitCode] = await once(cli, 'close')
assert.equal(exitCode, 0, stderr)
const cliReport = JSON.parse(stdout)
assert.equal(cliReport.counts.received, 1)
assert.equal(cliReport.counts.invalidOption, 1)
assert.equal(cliReport.input.oversizedLines, 1)
assert.equal(stdout.includes('15551234567'), false)

console.log('ok - agrega apenas eventos allowlist e estados conhecidos')
console.log('ok - calcula percentis aproximados por histograma sem derivar taxa de conclusão')
console.log('ok - ignora linha malformada e CLI descarta linha acima do limite')
console.log('ok - relatorio nao reproduz identificadores, conteúdo ou caminhos do log')
