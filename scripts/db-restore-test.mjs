import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'

const args = new Set(process.argv.slice(2))
if (!args.has('--confirm')) {
  console.error(JSON.stringify({
    service: 'firabot-maintenance',
    eventType: 'DATABASE_RESTORE_REJECTED',
    code: 400,
    message: 'Restore não executado. Use --confirm para restaurar em um banco temporário isolado.'
  }))
  process.exit(1)
}

const container = process.env.FIRABOT_DB_CONTAINER || 'firabot-mysql'
if (!/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('Nome de container inválido.')

const fileIndex = process.argv.indexOf('--file')
let backupPath
if (fileIndex >= 0 && process.argv[fileIndex + 1]) {
  backupPath = resolve(process.argv[fileIndex + 1])
} else {
  const backupDir = resolve('database/backups')
  const candidates = (await readdir(backupDir))
    .filter(name => name.endsWith('.sql'))
    .map(name => resolve(backupDir, name))
  const dated = await Promise.all(candidates.map(async file => ({ file, modified: (await stat(file)).mtimeMs })))
  dated.sort((a, b) => b.modified - a.modified)
  backupPath = dated[0]?.file
}

if (!backupPath) throw new Error('Nenhum backup .sql foi encontrado.')
const backupStats = await stat(backupPath)
if (!backupStats.isFile() || backupStats.size === 0) throw new Error('Arquivo de backup inválido ou vazio.')

const targetDatabase = `firabot_restore_${Date.now()}`
const shell = command => new Promise((resolvePromise, reject) => {
  const child = spawn('docker', ['exec', container, 'sh', '-c', command], { stdio: 'inherit' })
  child.once('error', reject)
  child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(`Docker terminou com código ${code}.`)))
})

// Criar e remover o banco temporário exige privilégio administrativo. A senha
// é expandida somente dentro do container e nunca é recebida pelo processo Node.
const mysqlAuth = '-uroot -p"$MYSQL_ROOT_PASSWORD"'
await shell(`exec mysql ${mysqlAuth} -e "CREATE DATABASE \\\`${targetDatabase}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"`)

try {
  const restore = spawn('docker', ['exec', '-i', container, 'sh', '-c', `exec mysql ${mysqlAuth} "${targetDatabase}"`], {
    stdio: ['pipe', 'inherit', 'inherit']
  })
  const restoreInput = pipeline(createReadStream(backupPath), restore.stdin)
  const [restoreCode] = await once(restore, 'close')
  await restoreInput
  if (restoreCode !== 0) throw new Error(`Restore terminou com código ${restoreCode}.`)

  await shell(`exec mysql ${mysqlAuth} -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${targetDatabase}'"`)
  console.log(JSON.stringify({
    service: 'firabot-maintenance',
    eventType: 'DATABASE_RESTORE_VERIFIED',
    code: 200,
    backup: basename(backupPath),
    targetDatabase
  }))
} finally {
  await shell(`exec mysql ${mysqlAuth} -e "DROP DATABASE IF EXISTS \\\`${targetDatabase}\\\`"`)
}
