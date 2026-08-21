import mysql from 'mysql2/promise';
import { config } from '../config.js';
import type { BotEventType, UserLogDetails } from '../services/logService.js';

export interface ActiveLinkRecord {
    title: string;
    url: string;
    scope?: string | null;
    sector_code?: string | null;
    sector_label?: string | null;
    sort_order?: number | null;
}

export interface ActiveNoticeRecord {
    title: string;
    url?: string | null;
    status: string;
    source: string;
    sector_code?: string | null;
    sector_label?: string | null;
    sort_order?: number | null;
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

function formatDatabaseError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
}

function databaseErrorLog(message: string, error: unknown) {
    /**
     * Este módulo não importa logService em runtime porque logService depende
     * de saveLog(), o que criaria ciclo. Mantemos o console estruturado aqui e
     * sem payloads sensíveis até separar um logger técnico independente.
     */
    console.error(JSON.stringify({
        at: new Date().toISOString(),
        level: 'error',
        eventType: 'DATABASE_ERROR',
        message,
        error: formatDatabaseError(error)
    }));
}

/**
 * Healthcheck usado na inicialização e no comando !status.
 * Faz uma consulta leve ao MySQL para confirmar credenciais, banco e charset.
 */
export async function checkDatabaseConnection(): Promise<{ ok: boolean; message: string }> {
    try {
        await pool.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
        await pool.query('SELECT 1');
        return { ok: true, message: 'Banco conectado' };
    } catch (error) {
        return { ok: false, message: explainDatabaseConnectionError(error) };
    }
}

/**
 * Garante que todo evento tenha um usuário associado antes de salvar estado/log.
 * A combinação INSERT IGNORE + SELECT mantém a operação idempotente para o mesmo
 * JID do WhatsApp e evita duplicar usuários.
 */
async function getUserId(phoneNumber: string, fullName?: string): Promise<number> {
    await pool.execute(
        'INSERT IGNORE INTO users (phone_number, full_name) VALUES (?, ?)',
        [phoneNumber, fullName || 'Aluno']
    );

    const [rows]: any = await pool.execute(
        'SELECT id FROM users WHERE phone_number = ?',
        [phoneNumber]
    );
    if (!rows[0]?.id) {
        throw new Error(`Usuário não encontrado após INSERT IGNORE: ${phoneNumber}`);
    }
    return rows[0].id;
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
        const [rows]: any = await pool.execute(
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

export async function saveLog(phoneNumber: string, userName: string, message: string, state?: string, eventType: BotEventType = 'MESSAGE_RECEIVED', details: UserLogDetails = {}): Promise<void> {
    try {
        const userId = await getUserId(phoneNumber, userName);
        await pool.execute(
            `INSERT INTO logs
             (user_id, message, message_preview, state, state_before, state_after, event_type, command, menu, document_id, success, error_message)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                message,
                message,
                state || null,
                details.stateBefore || null,
                details.stateAfter || null,
                eventType,
                details.command || null,
                details.menu || null,
                details.documentId ? String(details.documentId) : null,
                typeof details.success === 'boolean' ? details.success : null,
                details.errorMessage || null
            ]
        );
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
        await pool.execute(
            `INSERT INTO support_tickets (user_id, sector_code, sector_label, status, message_preview)
             VALUES (?, 'suporte', 'Suporte', 'novo', ?)`,
            [userId, preview || 'Solicitação registrada pelo bot.']
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
export async function getActiveDocs(categoryCode?: string, options: { throwOnError?: boolean } = {}): Promise<any[]> {
    try {
        const [rows] = categoryCode
            ? await pool.execute(
                'SELECT name, path, category_code, category_label, sort_order, summary FROM docs WHERE is_active = 1 AND category_code = ? ORDER BY COALESCE(sort_order, id), id ASC',
                [categoryCode]
            )
            : await pool.execute(
                'SELECT name, path, category_code, category_label, sort_order, summary FROM docs WHERE is_active = 1 ORDER BY COALESCE(sort_order, id), id ASC'
            );
        return rows as any[];
    } catch (error) {
        databaseErrorLog('Erro ao buscar documentos no banco', error);
        if (options.throwOnError) throw error;
        return []; // Retorna lista vazia em caso de erro para não travar o bot
    }
}

export async function countActiveDocs(): Promise<number> {
    try {
        const [rows]: any = await pool.execute(
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
        const [rows] = await pool.execute(
            `SELECT title, url, scope, sector_code, sector_label, sort_order
               FROM important_links
              WHERE is_active = 1
              ORDER BY COALESCE(sort_order, id), id ASC`
        );
        return rows as ActiveLinkRecord[];
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
        const [rows] = await pool.execute(
            `SELECT title, url, status, source, sector_code, sector_label, sort_order
               FROM notices
              WHERE is_active = 1
              ORDER BY COALESCE(sort_order, id), id ASC
              LIMIT 10`
        );
        return rows as ActiveNoticeRecord[];
    } catch (error) {
        databaseErrorLog('Erro ao buscar editais no banco', error);
        if (options.throwOnError) throw error;
        return [];
    }
}
