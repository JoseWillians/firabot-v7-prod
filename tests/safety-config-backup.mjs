import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  DOTENV_CONFIG_PATH: resolve(repositoryRoot, '.firabot-test-env-does-not-exist'),
  DB_HOST: '127.0.0.1',
  DB_USER: 'firabot-test',
  DB_NAME: '',
  MYSQL_DATABASE: 'firabot_test',
  FIRABOT_APP_DB_PASSWORD: 'synthetic-test-password-only',
  SPAM_WINDOW_MS: '',
  MESSAGE_DEDUP_TTL_MS: '  ',
  RECONNECT_DELAY_MS: '',
  DB_PORT: ''
}

const configCheck = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '--eval',
    `
    const { config } = await import('./src/config.ts')
    console.log(JSON.stringify({
      spamWindowMs: config.spamWindowMs,
      messageDedupTtlMs: config.messageDedupTtlMs,
      reconnectDelayMs: config.reconnectDelayMs,
      databasePort: config.database.port,
      databaseName: config.database.name,
      databasePasswordConfigured: Boolean(config.database.password)
    }))
  `
  ],
  { cwd: repositoryRoot, env: testEnv, encoding: 'utf8' }
)

assert.equal(configCheck.status, 0, configCheck.stderr)
assert.deepEqual(JSON.parse(configCheck.stdout), {
  spamWindowMs: 2500,
  messageDedupTtlMs: 10 * 60 * 1000,
  reconnectDelayMs: 5000,
  databasePort: 3306,
  databaseName: 'firabot_test',
  databasePasswordConfigured: true
})

const mismatchCheck = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '--eval',
    "const { validateConfig } = await import('./src/config.ts'); validateConfig()"
  ],
  {
    cwd: repositoryRoot,
    env: { ...testEnv, DB_NAME: 'firabot_other' },
    encoding: 'utf8'
  }
)

assert.notEqual(mismatchCheck.status, 0)
assert.match(mismatchCheck.stderr, /DB_NAME deve ser igual a MYSQL_DATABASE quando ambos forem definidos\./)

const invalidNumericCheck = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '--eval',
    `
    const { validateConfig } = await import('./src/config.ts')
    try {
      validateConfig()
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  `
  ],
  {
    cwd: repositoryRoot,
    env: { ...testEnv, DB_NAME: 'firabot_test', MYSQL_DATABASE: 'firabot_test', SPAM_WINDOW_MS: '-1' },
    encoding: 'utf8'
  }
)

assert.notEqual(invalidNumericCheck.status, 0)
assert.match(invalidNumericCheck.stderr, /Configuração numérica inválida\. Revise: SPAM_WINDOW_MS/)

const excessiveTimerCheck = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '--eval',
    "const { validateConfig } = await import('./src/config.ts'); validateConfig()"
  ],
  {
    cwd: repositoryRoot,
    env: { ...testEnv, DB_NAME: 'firabot_test', MYSQL_DATABASE: 'firabot_test', RECONNECT_DELAY_MS: '2147483648' },
    encoding: 'utf8'
  }
)

assert.notEqual(excessiveTimerCheck.status, 0)
assert.match(excessiveTimerCheck.stderr, /Configuração numérica inválida\. Revise: RECONNECT_DELAY_MS/)

const accidentalBackupPath = resolve(repositoryRoot, 'src', 'firabot-backup-guard-test.sql')
const backupCheck = spawnSync(
  process.execPath,
  [resolve(repositoryRoot, 'scripts', 'db-backup.mjs'), accidentalBackupPath],
  { cwd: repositoryRoot, env: testEnv, encoding: 'utf8' }
)

assert.notEqual(backupCheck.status, 0)
assert.match(backupCheck.stderr, /Backups dentro do repositório devem ficar em database\/backups\//)
assert.equal(existsSync(accidentalBackupPath), false)

const provisioner = readFileSync(resolve(repositoryRoot, 'scripts', 'db-provision-runtime-user.sh'), 'utf8')
assert.match(provisioner, /DROP USER IF EXISTS 'firabot'@'%'/)

for (const maintenanceScript of ['db-backup.mjs', 'db-migrate.mjs', 'db-restore-test.mjs']) {
  const source = readFileSync(resolve(repositoryRoot, 'scripts', maintenanceScript), 'utf8')
  assert.doesNotMatch(source, /-p"\$MYSQL_(?:ROOT_)?PASSWORD"/)
}

console.log('ok - valores numéricos vazios usam padrões seguros e backup não grava fora da pasta ignorada')
