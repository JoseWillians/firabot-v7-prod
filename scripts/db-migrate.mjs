import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'

const container = process.env.FIRABOT_DB_CONTAINER || 'firabot-mysql'
if (!/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('Nome de container inválido.')

const migrationsDir = resolve('database/migrations')
const migrations = (await readdir(migrationsDir))
  .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
  .sort((left, right) => left.localeCompare(right))

const mysqlCommand = '-u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'

function runDocker(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, options)
    let stdout = ''

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim())
      else reject(new Error(`Docker terminou com código ${code}.`))
    })
  })
}

async function query(sql) {
  return runDocker(
    ['exec', container, 'sh', '-c', `exec mysql ${mysqlCommand} -N -e "$1"`, 'firabot-migrate', sql],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  )
}

await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(191) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

for (const migrationName of migrations) {
  const migrationPath = resolve(migrationsDir, migrationName)
  const version = basename(migrationName, '.sql')
  const sql = await readFile(migrationPath)
  const checksum = createHash('sha256').update(sql).digest('hex')
  const existingChecksum = await query(
    `SELECT checksum FROM schema_migrations WHERE version = '${version}' LIMIT 1`
  )

  if (existingChecksum) {
    if (existingChecksum !== checksum) {
      console.error(JSON.stringify({
        service: 'firabot-maintenance',
        eventType: 'DATABASE_MIGRATION_CONFLICT',
        code: 409,
        migration: migrationName
      }))
      process.exit(1)
    }
    continue
  }

  const child = spawn('docker', ['exec', '-i', container, 'sh', '-c', `exec mysql ${mysqlCommand}`], {
    stdio: ['pipe', 'inherit', 'inherit']
  })
  const migrationInput = pipeline(createReadStream(migrationPath), child.stdin)
  const [exitCode] = await once(child, 'close')
  await migrationInput
  if (exitCode !== 0) throw new Error(`Migration ${migrationName} terminou com código ${exitCode}.`)

  await query(
    `INSERT INTO schema_migrations (version, checksum) VALUES ('${version}', '${checksum}')`
  )
  console.log(JSON.stringify({
    service: 'firabot-maintenance',
    eventType: 'DATABASE_MIGRATION_APPLIED',
    code: 200,
    migration: migrationName
  }))
}

console.log(JSON.stringify({
  service: 'firabot-maintenance',
  eventType: 'DATABASE_MIGRATIONS_CURRENT',
  code: 200,
  total: migrations.length
}))
