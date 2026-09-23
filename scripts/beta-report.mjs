import { createBetaMetricsAccumulator, betaMetricsMaxLineBytes } from '../dist/services/betaMetricsService.js'

const metrics = createBetaMetricsAccumulator()
let lineChunks = []
let lineBytes = 0
let skippingOversizedLine = false

function consumeCompleteLine() {
  if (skippingOversizedLine) {
    metrics.consumeOversizedLine()
  } else if (lineBytes > 0) {
    const line = Buffer.concat(lineChunks, lineBytes)
    const withoutCarriageReturn = line.at(-1) === 13 ? line.subarray(0, -1) : line
    metrics.consumeLine(withoutCarriageReturn.toString('utf8'))
  }
  lineChunks = []
  lineBytes = 0
  skippingOversizedLine = false
}

function consumeSegment(segment) {
  if (skippingOversizedLine) return
  if (lineBytes + segment.length > betaMetricsMaxLineBytes) {
    lineChunks = []
    lineBytes = 0
    skippingOversizedLine = true
    return
  }
  if (segment.length > 0) {
    lineChunks.push(segment)
    lineBytes += segment.length
  }
}

for await (const chunk of process.stdin) {
  let start = 0
  while (start < chunk.length) {
    const newline = chunk.indexOf(10, start)
    if (newline === -1) {
      consumeSegment(chunk.subarray(start))
      break
    }
    consumeSegment(chunk.subarray(start, newline))
    consumeCompleteLine()
    start = newline + 1
  }
}

if (skippingOversizedLine) metrics.consumeOversizedLine()
else if (lineBytes > 0) consumeCompleteLine()

process.stdout.write(`${JSON.stringify(metrics.snapshot())}\n`)
