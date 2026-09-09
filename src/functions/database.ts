import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import type { BotEventType, UserLogDetails } from '../services/logService.js';
import { BotResultCode, type BotResultCodeValue } from '../types/resultCode.js';
import { getPhoneE164FromJids } from '../services/userIdentityService.js';
import { technicalErrorLog } from '../services/technicalLogger.js';

export interface ActiveLinkRecord extends RowDataPacket {
    title: string;
    url: string;
    scope?: string | null;
    sector_code?: string | null;
    sector_label?: string | null;
    sort_order?: number | null;
    source?: string | null;
    content_owner?: string | null;
    reviewed_at?: Date | string | null;
    expires_at?: Date | string | null;
}

export interface ActiveNoticeRecord extends RowDataPacket {
    title: string;
    url?: string | null;
    status: string;
    source: string;
    sector_code?: string | null;
    sector_label?: string | null;
    sort_order?: number | null;
    content_owner?: string | null;
    reviewed_at?: Date | string | null;
    expires_at?: Date | string | null;
}

export interface ActiveDocumentRecord extends RowDataPacket {
    name: string;
    path: string;
    category_code?: string | null;
    category_label?: string | null;
    sort_order?: number | null;
    summary?: string | null;
}

interface UserIdRow extends RowDataPacket {
    id: number;
}

interface UserStateRow extends RowDataPacket {
    state: string;
    updated_at: Date | string | null;
}

interface UserPhoneIdentityRow extends RowDataPacket {
    phone_e164: string | null;
}

interface CountRow extends RowDataPacket {
    total: number | string;
}

const pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10
});

pool.on('connection', (connection) => {
    connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
});

function explainDatabaseConnectionError(error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ECONNREFUSED') {
        return 'Não foi possível conectar ao MySQL. Verifique se o Docker está ativo, se o container firabot-mysql subiu, e se DB_HOST/DB_PORT/.env apontam para 127.0.0.1:3306 no desenvolvimento local.';
    }

    return 'Falha ao conectar ao MySQL. Verifique DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e DB_NAME no .env.';
}

function databaseErrorLog(message: string, error: unknown) {
    technicalErrorLog('DATABASE_ERROR', message, error, BotResultCode.SERVICE_UNAVAILABLE);
}

/**
 * Healthcheck usado na inicialização e no comando !status.
 * Faz uma consulta leve ao MySQL para confirmar credenciais, banco e charset.
 */
export async function checkDatabaseConnection(): Promise<{ ok: boolean; code: BotResultCodeValue; message: string }> {
    try {
        await pool.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
        await pool.query('SELECT 1');
        return { ok: true, code: BotResultCode.OK, message: 'Banco conectado' };
    } catch (error) {
        return { ok: false, code: BotResultCode.SERVICE_UNAVAILABLE, message: explainDatabaseConnectionError(error) };
    }
}

/**
 * Garante que todo evento tenha um usuário associado antes de salvar estado/log.
 * Primeiro procura uma identidade existente por JID ou telefone E.164. Isso
 * evita duplicar a mesma pessoa quando o Baileys alterna entre PN e LID.
 */
function normalizeUsefulName(fullName?: string) {
    const normalized = fullName?.trim().slice(0, 255)
    if (!normalized || ['aluno', 'aluno(a)'].includes(normalized.toLowerCase())) return null
    return normalized
}

export async function upsertUserIdentity(primaryJid: string, fullName?: string, alternateJids: string[] = []): Promise<number> {
    const allJids = [...new Set([primaryJid, ...alternateJids].filter(Boolean))]
    const phoneE164 = getPhoneE164FromJids(allJids)
    const usefulName = normalizeUsefulName(fullName)

    const jidPlaceholders = allJids.map(() => '?').join(', ')
    const [existingRows] = await pool.execute<UserIdRow[]>(
        `SELECT id
           FROM users
          WHERE phone_number IN (${jidPlaceholders})
             OR whatsapp_jid IN (${jidPlaceholders})
             OR (? IS NOT NULL AND phone_e164 = ?)
          ORDER BY (phone_number = ?) DESC
          LIMIT 1`,
        [...allJids, ...allJids, phoneE164, phoneE164, primaryJid]
    )

    if (existingRows[0]?.id) {
        await pool.execute(
            `UPDATE users
                SET whatsapp_jid = ?,
                    phone_e164 = COALESCE(?, phone_e164),
                    full_name = COALESCE(?, full_name),
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [primaryJid, phoneE164, usefulName, existingRows[0].id]
        )
        return existingRows[0].id
    }

    await pool.execute(
        `INSERT INTO users (phone_number, whatsapp_jid, phone_e164, full_name)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           whatsapp_jid = VALUES(whatsapp_jid),
           phone_e164 = COALESCE(VALUES(phone_e164), phone_e164),
           full_name = COALESCE(VALUES(full_name), full_name),
           updated_at = CURRENT_TIMESTAMP`,
        [primaryJid, primaryJid, phoneE164, usefulName]
    );

    const [rows] = await pool.execute<UserIdRow[]>(
        'SELECT id FROM users WHERE phone_number = ?',
        [primaryJid]
    );
    if (!rows[0]?.id) {
        throw new Error('Usuário não encontrado após atualização de identidade.');
    }
    return rows[0].id;
}

/**
 * Recupera o telefone já associado a um JID sem expor a identidade em logs.
 * Serve como fallback quando uma nova mensagem chega apenas como LID e o mapa
 * em memória do Baileys ainda não está disponível.
 */
export async function getStoredPhoneE164ForJids(jids: string[]): Promise<string | null> {
    const candidates = [...new Set(jids.filter(Boolean))]
    if (!candidates.length) return null

    const placeholders = candidates.map(() => '?').join(', ')
    const [rows] = await pool.execute<UserPhoneIdentityRow[]>(
        `SELECT phone_e164
           FROM users
          WHERE phone_e164 IS NOT NULL
            AND (phone_number IN (${placeholders}) OR whatsapp_jid IN (${placeholders}))
          ORDER BY updated_at DESC
          LIMIT 1`,
        [...candidates, ...candidates]
    )
    return rows[0]?.phone_e164 || null
}

async function getUserId(phoneNumber: string, fullName?: string): Promise<number> {
    return upsertUserIdentity(phoneNumber, fullName)
}

/**
 * Busca estado persistido no MySQL.
 * Erros são relançados para que a camada de serviço registre fallback explícito
 * em memória, sem mascarar problemas de banco como se fossem estado "main".
 */
export async function getUserState(phoneNumber: string): Promise<string> {
    const record = await getUserStateRecord(phoneNumber);
    return record.state;
}

export async function getUserStateRecord(phoneNumber: string): Promise<{ state: string; updatedAt: Date | null }> {
    try {
        const userId = await getUserId(phoneNumber);
        const [rows] = await pool.execute<UserStateRow[]>(
            'SELECT state, updated_at FROM user_states WHERE user_id = ?',
            [userId]
        );
        return rows.length > 0
            ? { state: rows[0].state, updatedAt: rows[0].updated_at ? new Date(rows[0].updated_at) : null }
            : { state: 'main', updatedAt: null };
    } catch (error) {
        databaseErrorLog('Erro ao obter estado do usuário', error);
        throw error;
    }
}

export async function setUserState(phoneNumber: string, state: string): Promise<void> {
    try {
        const userId = await getUserId(phoneNumber);
        await pool.execute(
            `INSERT INTO user_states (user_id, state) VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE state = ?, updated_at = CURRENT_TIMESTAMP`,
            [userId, state, state]
        );
    } catch (error) {
        databaseErrorLog('Erro ao definir estado do usuário', error);
        throw error;
    }
}

export function prepareLogMessageStorage(messagePreview: string) {
    return {
        legacyMessage: '',
        messagePreview: messagePreview.trim().slice(0, 255)
    };
}

export async function saveLog(phoneNumber: string, userName: string, messagePreview: string, state?: string, eventType: BotEventType = 'MESSAGE_RECEIVED', details: UserLogDetails = {}): Promise<void> {
    try {
        const userId = await getUserId(phoneNumber, userName);
        const storedMessage = prepareLogMessageStorage(messagePreview);
        const legacyValues = [
            userId,
            storedMessage.legacyMessage,
            storedMessage.messagePreview,
            state || null,
            details.stateBefore || null,
            details.stateAfter || null,
            eventType,
            details.command || null,
            details.menu || null,
            details.documentId ? String(details.documentId) : null,
            typeof details.success === 'boolean' ? details.success : null,
            details.errorMessage || null
        ];

        /**
         * A coluna message é mantida vazia por compatibilidade com bancos
         * existentes. O conteúdo integral não é persistido: somente o preview
         * truncado e sanitizado chega a message_preview, reduzindo exposição de
         * dados pessoais sem exigir uma alteração destrutiva imediata no schema.
         */

        try {
            await pool.execute(
                `INSERT INTO logs
                 (user_id, message, message_preview, state, state_before, state_after, event_type, command, menu, document_id, success, error_message, result_code, correlation_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [...legacyValues, details.resultCode || null, details.correlationId || null]
            );
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : undefined;
            if (code !== 'ER_BAD_FIELD_ERROR') throw error;

            // Compatibilidade temporária: o bot continua registrando eventos
            // durante a janela entre deploy do código e aplicação da migration.
            databaseErrorLog('Tabela logs sem result_code/correlation_id; usando formato legado', error);
            await pool.execute(
                `INSERT INTO logs
                 (user_id, message, message_preview, state, state_before, state_after, event_type, command, menu, document_id, success, error_message)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                legacyValues
            );
        }
    } catch (error) {
        databaseErrorLog('Erro ao salvar log', error);
        throw error;
    }
}

/**
 * Registra a solicitação de suporte em uma fila própria para o painel.
 * Guardamos apenas um preview limitado da mensagem para reduzir exposição de
 * dados pessoais até existir política institucional de retenção e tratamento.
 */
export async function createSupportTicket(phoneNumber: string, userName: string, message: string): Promise<void> {
    try {
        const userId = await getUserId(phoneNumber, userName);
        const preview = message.trim().slice(0, 500);
        const expiresAt = config.supportTicketRetentionDays > 0
            ? new Date(Date.now() + config.supportTicketRetentionDays * 24 * 60 * 60 * 1000)
            : null;
        await pool.execute(
            `INSERT INTO support_tickets (user_id, sector_code, sector_label, status, message_preview, expires_at)
             VALUES (?, 'suporte', 'Suporte', 'novo', ?, ?)`,
            [userId, preview || 'Solicitação registrada pelo bot.', expiresAt]
        );
    } catch (error) {
        databaseErrorLog('Erro ao criar chamado de suporte', error);
        throw error;
    }
}


/**
 * Busca documentos ativos para montar o submenu em tempo de execução.
 * Em caso de erro, retorna lista vazia: o documentService registra o problema e
 * aplica fallback local para não interromper o atendimento.
 */
export async function getActiveDocs(categoryCode?: string, options: { throwOnError?: boolean } = {}): Promise<ActiveDocumentRecord[]> {
    try {
        const [rows] = categoryCode
            ? await pool.execute<ActiveDocumentRecord[]>(
                'SELECT name, path, category_code, category_label, sort_order, summary FROM docs WHERE is_active = 1 AND category_code = ? ORDER BY COALESCE(sort_order, id), id ASC',
                [categoryCode]
            )
            : await pool.execute<ActiveDocumentRecord[]>(
                'SELECT name, path, category_code, category_label, sort_order, summary FROM docs WHERE is_active = 1 ORDER BY COALESCE(sort_order, id), id ASC'
            );
        return rows;
    } catch (error) {
        databaseErrorLog('Erro ao buscar documentos no banco', error);
        if (options.throwOnError) throw error;
        return []; // Retorna lista vazia em caso de erro para não travar o bot
    }
}

export async function countActiveDocs(): Promise<number> {
    try {
        const [rows] = await pool.execute<CountRow[]>(
            'SELECT COUNT(*) AS total FROM docs WHERE is_active = 1'
        );
        return Number(rows[0]?.total || 0);
    } catch (error) {
        databaseErrorLog('Erro ao contar documentos ativos', error);
        throw error;
    }
}

/**
 * Links importantes também são conteúdo administrável pelo painel.
 * O bot lê a tabela em tempo de execução para que inclusões feitas pelo painel
 * apareçam sem alteração de código, mantendo fallback no fluxo de menu.
 */
export async function getActiveImportantLinks(options: { throwOnError?: boolean } = {}): Promise<ActiveLinkRecord[]> {
    try {
        const [rows] = await pool.execute<ActiveLinkRecord[]>(
            `SELECT title, url, scope, sector_code, sector_label, sort_order,
                    source, content_owner, reviewed_at, expires_at
               FROM important_links
              WHERE is_active = 1
                AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
              ORDER BY COALESCE(sort_order, id), id ASC`
        );
        return rows;
    } catch (error) {
        databaseErrorLog('Erro ao buscar links importantes no banco', error);
        if (options.throwOnError) throw error;
        return [];
    }
}

/**
 * Editais cadastrados no painel são a fonte dinâmica preferencial.
 * A lista local continua existindo apenas como fallback quando o banco ainda
 * não tem dados suficientes ou está temporariamente indisponível.
 */
export async function getActiveNotices(options: { throwOnError?: boolean } = {}): Promise<ActiveNoticeRecord[]> {
    try {
        const [rows] = await pool.execute<ActiveNoticeRecord[]>(
            `SELECT title, url, status, source, sector_code, sector_label, sort_order,
                    content_owner, reviewed_at, expires_at
               FROM notices
              WHERE is_active = 1
                AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
              ORDER BY COALESCE(sort_order, id), id ASC
              LIMIT 10`
        );
        return rows;
    } catch (error) {
        databaseErrorLog('Erro ao buscar editais no banco', error);
        if (options.throwOnError) throw error;
        return [];
    }
}

export async function deleteExpiredSupportTickets(now = new Date()) {
    const [result] = await pool.execute<ResultSetHeader>(
        'DELETE FROM support_tickets WHERE expires_at IS NOT NULL AND expires_at <= ?',
        [now]
    )
    return result.affectedRows
}

export async function closeDatabasePool() {
    await pool.end()
}
