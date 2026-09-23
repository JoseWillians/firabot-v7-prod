import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as prettier from 'prettier'

const isCi = process.env.GITHUB_ACTIONS === 'true'
const eventName = process.env.GITHUB_EVENT_NAME
const before = process.env.GITHUB_EVENT_BEFORE
const sha = process.env.GITHUB_SHA
const baseRef = process.env.GITHUB_BASE_REF
const zeroSha = /^0+$/.test(before ?? '')

let diffRange = ['HEAD']
if (isCi && eventName === 'pull_request' && baseRef) {
  diffRange = [`origin/${baseRef}...HEAD`]
} else if (isCi && eventName === 'push' && before && sha && !zeroSha) {
  diffRange = [before, sha]
} else if (isCi) {
  diffRange = ['HEAD^', 'HEAD']
}

const trackedChanges = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', ...diffRange, '--'], {
  encoding: 'utf8'
}).split(/\r?\n/)
const untrackedChanges = isCi
  ? []
  : execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(/\r?\n/)
const changedFiles = [...new Set([...trackedChanges, ...untrackedChanges])].filter((file) =>
  /\.(?:ts|tsx|js|mjs|cjs|json|yml|yaml)$/.test(file)
)

if (!changedFiles.length) {
  console.log('Nenhum arquivo de código alterado para verificar.')
  process.exit(0)
}

const unformatted = []
for (const file of changedFiles) {
  const absolutePath = path.resolve(file)
  const source = await readFile(absolutePath, 'utf8')
  const options = await prettier.resolveConfig(absolutePath)
  const formatted = await prettier.format(source, { ...options, filepath: absolutePath })
  if (formatted !== source) unformatted.push(file)
}

if (unformatted.length) {
  console.error('Arquivos fora do formato configurado:')
  for (const file of unformatted) console.error(`- ${file}`)
  console.error('Aplique npx prettier --write <arquivo> somente nos arquivos alterados.')
  process.exitCode = 1
} else {
  console.log(`Formatação aprovada em ${changedFiles.length} arquivo(s) de código alterado(s).`)
}
