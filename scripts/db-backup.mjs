import { createWriteStream } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backupDirectory = resolve(repositoryRoot, 'database', 'backups')

const isWithinDirectory = (directory, candidate) => {
  const pathFromDirectory = relative(directory, candidate)
  return (
    pathFromDirectory === '' ||
    (pathFromDirectory !== '..' && !pathFromDirectory.startsWith(`..${sep}`) && !isAbsolute(pathFromDirectory))
  )
}

const container = process.env.FIRABOT_DB_CONTAINER || 'firabot-mysql'
if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
  throw new Error('FIRABOT_DB_CONTAINER contém caracteres inválidos.')
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const requestedPath = process.argv[2]
const outputPath = resolve(requestedPath || resolve(backupDirectory, `firabot_${timestamp}.sql`))

if (isWithinDirectory(repositoryRoot, outputPath) && !isWithinDirectory(backupDirectory, outputPath)) {
  throw new Error('Backups dentro do repositório devem ficar em database/backups/.')
}

await mkdir(dirname(outputPath), { recursive: true })
const [realRepositoryRoot, realOutputDirectory] = await Promise.all([
  realpath(repositoryRoot),
  realpath(dirname(outputPath))
])
const realBackupDirectory = resolve(realRepositoryRoot, 'database', 'backups')

if (
  isWithinDirectory(realRepositoryRoot, realOutputDirectory) &&
  !isWithinDirectory(realBackupDirectory, realOutputDirectory)
) {
  throw new Error('Backups dentro do repositório devem ficar em database/backups/.')
}

const dumpCommand =
  'export MYSQL_PWD="$MYSQL_PASSWORD"; exec mysqldump --single-transaction --no-tablespaces --routines --triggers --events --set-gtid-purged=OFF --user="$MYSQL_USER" "$MYSQL_DATABASE"'
const child = spawn('docker', ['exec', container, 'sh', '-c', dumpCommand], {
  stdio: ['ignore', 'pipe', 'inherit']
})
const output = createWriteStream(outputPath, { flags: 'wx' })
const writePromise = pipeline(child.stdout, output)

const [exitCode] = await once(child, 'close')
if (exitCode !== 0) {
  throw new Error(`mysqldump terminou com código ${exitCode}.`)
}

await writePromise
const file = await stat(outputPath)
if (file.size === 0) throw new Error('Backup criado sem conteúdo.')

console.log(
  JSON.stringify({
    service: 'firabot-maintenance',
    eventType: 'DATABASE_BACKUP_CREATED',
    code: 200,
    file: basename(outputPath),
    sizeBytes: file.size
  })
)
