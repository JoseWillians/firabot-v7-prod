import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'

const container = process.env.FIRABOT_DB_CONTAINER || 'firabot-mysql'
if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
  throw new Error('FIRABOT_DB_CONTAINER contém caracteres inválidos.')
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const requestedPath = process.argv[2]
const outputPath = resolve(requestedPath || `database/backups/firabot_${timestamp}.sql`)
await mkdir(dirname(outputPath), { recursive: true })

const dumpCommand = 'exec mysqldump --single-transaction --no-tablespaces --routines --triggers --events --set-gtid-purged=OFF -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
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

console.log(JSON.stringify({
  service: 'firabot-maintenance',
  eventType: 'DATABASE_BACKUP_CREATED',
  code: 200,
  file: basename(outputPath),
  sizeBytes: file.size
}))
