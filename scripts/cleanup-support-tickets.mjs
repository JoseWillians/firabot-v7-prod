import { closeDatabasePool, deleteExpiredSupportTickets } from '../dist/functions/database.js'
import { config } from '../dist/config.js'

if (!process.argv.includes('--confirm')) {
  console.error(JSON.stringify({ eventType: 'SUPPORT_RETENTION_REJECTED', code: 400, message: 'Use --confirm.' }))
  process.exitCode = 1
} else if (config.supportTicketRetentionDays <= 0) {
  console.error(JSON.stringify({ eventType: 'SUPPORT_RETENTION_DISABLED', code: 409, message: 'Defina SUPPORT_TICKET_RETENTION_DAYS acima de zero.' }))
  process.exitCode = 1
} else {
  try {
    const deleted = await deleteExpiredSupportTickets()
    console.log(JSON.stringify({ eventType: 'SUPPORT_RETENTION_COMPLETED', code: 200, deleted }))
  } finally {
    await closeDatabasePool()
  }
}
