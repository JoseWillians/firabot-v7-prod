import * as fs from 'fs'
import { promises as fsPromises } from 'fs'
import * as path from 'path'
import { WASocket } from 'baileys'
import { getActiveDocs } from '../functions/database.js'
import { config } from '../config.js'
import { createDocsMenu, fallbackDocuments } from '../menus/docsMenu.js'
import { formatMenu } from './menuService.js'
import { debugLog, errorLog } from './logService.js'

export interface ActiveDocument {
  key: string
  label: string
  path: string
  summary?: string
}

export interface DocumentSendResult {
  success: boolean
  absolutePath: string
  errorMessage?: string
}

export interface DocumentsHealth {
  ok: boolean
  totalActive: number
  found: number
  missing: number
  missingDocuments: ActiveDocument[]
  errorMessage?: string
}

function resolveDocumentPath(documentPath: string) {
  const basePath = path.resolve(config.documentsBasePath)
  const resolvedPath = path.isAbsolute(documentPath)
    ? path.resolve(documentPath)
    : documentPath.startsWith('./documentos') || documentPath.startsWith('documentos')
      ? path.resolve(documentPath)
      : path.resolve(basePath, documentPath)

  return resolvedPath
}

export function resolveSafeDocumentPath(documentPath: string) {
  const basePath = path.resolve(config.documentsBasePath)
  const resolvedPath = resolveDocumentPath(documentPath)
  const relativePath = path.relative(basePath, resolvedPath)
  const isInsideDocumentsDir = relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))

  return {
    absolutePath: resolvedPath,
    isInsideDocumentsDir
  }
}

async function getDocumentsForHealthcheck(): Promise<ActiveDocument[]> {
  const docs = await getActiveDocs(undefined, { throwOnError: true })
  return docs.map((doc: { name: string; path: string; summary?: string }, index: number) => ({
    key: String(index + 1),
    label: doc.name,
    path: doc.path,
    summary: doc.summary || getDocumentSummary(doc.name, doc.path)
  }))
}

function mapFallbackDocuments(): ActiveDocument[] {
  return fallbackDocuments.map(doc => ({
    key: doc.key,
    label: doc.label,
    path: doc.path,
    summary: doc.summary
  }))
}

function getDocumentSummary(label: string, documentPath: string) {
  const normalized = `${label} ${documentPath}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  if (normalized.includes('diploma') && normalized.includes('tecnico')) {
    return 'Use este formulário para solicitar emissão ou encaminhamento relacionado ao diploma de curso técnico.'
  }

  if (normalized.includes('requerimento superior')) {
    return 'Use este requerimento para solicitações acadêmicas de cursos superiores, como aproveitamento, declarações ou demandas de registro acadêmico.'
  }

  if (normalized.includes('termo de desistencia')) {
    return 'Use este termo quando o estudante desejar formalizar a desistência do curso ou de vínculo acadêmico, conforme orientação institucional.'
  }

  if (normalized.includes('requerimento academico')) {
    return 'Use este requerimento para solicitar serviços acadêmicos gerais junto à DRCA, como ajustes, declarações ou outros procedimentos administrativos.'
  }

  if (normalized.includes('ppc')) {
    return 'Este PPC apresenta a estrutura oficial do curso, incluindo matriz curricular, carga horária, perfil do egresso e regras acadêmicas da formação.'
  }

  return 'Este documento ajuda no atendimento acadêmico e deve ser utilizado conforme a orientação do setor responsável.'
}

/**
 * Carrega documentos ativos do banco para montar o menu dinamicamente.
 * Se o banco estiver indisponível ou vazio, usa uma lista local de fallback
 * para manter o atendimento básico funcionando.
 */
export async function getAvailableDocuments(categoryCode = 'drca'): Promise<ActiveDocument[]> {
  try {
    const docs = await getActiveDocs(categoryCode)
    if (!docs.length) return categoryCode === 'drca' ? mapFallbackDocuments() : []

    return docs.map((doc: { name: string; path: string; summary?: string }, index: number) => ({
      key: String(index + 1),
      label: doc.name,
      path: doc.path,
      summary: doc.summary || getDocumentSummary(doc.name, doc.path)
    }))
  } catch (error) {
    errorLog('DATABASE_ERROR', 'Erro ao carregar documentos ativos. Usando lista local de fallback', error)
    return categoryCode === 'drca' ? mapFallbackDocuments() : []
  }
}

export async function formatDocumentsMenu(categoryCode = 'drca', title?: string) {
  const documents = await getAvailableDocuments(categoryCode)
  return formatMenu(createDocsMenu(documents, title))
}

export async function findDocumentByOption(option: string, categoryCode = 'drca'): Promise<ActiveDocument | undefined> {
  const documents = await getAvailableDocuments(categoryCode)
  return documents.find(doc => doc.key === option)
}

export function formatDocumentSuccessMessage(document: ActiveDocument) {
  return document.summary
    ? `Documento enviado com sucesso.\n\nResumo: ${document.summary}`
    : 'Documento enviado com sucesso.'
}

export async function checkDocumentsHealth(): Promise<DocumentsHealth> {
  let documents: ActiveDocument[]

  try {
    documents = await getDocumentsForHealthcheck()
  } catch (error) {
    errorLog('DATABASE_ERROR', 'Erro ao carregar documentos para healthcheck', error)
    return {
      ok: false,
      totalActive: 0,
      found: 0,
      missing: 0,
      missingDocuments: [],
      errorMessage: error instanceof Error ? error.message : 'Erro ao carregar documentos para healthcheck'
    }
  }

  const missingDocuments = documents.filter(document => {
    const resolved = resolveSafeDocumentPath(document.path)
    return !resolved.isInsideDocumentsDir || !fs.existsSync(resolved.absolutePath)
  })

  debugLog('Healthcheck de documentos concluído', {
    eventType: missingDocuments.length ? 'DOCUMENT_ERROR' : 'DOCUMENT_HEALTH',
    totalActive: documents.length,
    found: documents.length - missingDocuments.length,
    missing: missingDocuments.length,
    missingDocuments
  })

  return {
    ok: true,
    totalActive: documents.length,
    found: documents.length - missingDocuments.length,
    missing: missingDocuments.length,
    missingDocuments
  }
}

export async function sendDocument(sock: WASocket, jid: string, document: ActiveDocument): Promise<DocumentSendResult> {
  const resolved = resolveSafeDocumentPath(document.path)
  const filePath = resolved.absolutePath

  try {
    /**
     * Paths cadastrados no banco nunca podem escapar de DOCUMENTS_DIR.
     * Essa proteção é essencial antes do painel administrativo permitir upload
     * ou edição de documentos por administradores setoriais.
     */
    if (!resolved.isInsideDocumentsDir) {
      await sock.sendMessage(jid, { text: 'Encontrei essa opção, mas o caminho do arquivo está inválido. Entre em contato com o suporte.' })
      errorLog('DOCUMENT_ERROR', 'Caminho de documento fora da pasta permitida', new Error('Caminho fora de DOCUMENTS_DIR'), { user: jid, documentId: document.key, document })
      debugLog('Caminho absoluto de documento bloqueado', { eventType: 'DOCUMENT_ERROR', user: jid, documentId: document.key, absolutePath: filePath })
      return { success: false, absolutePath: filePath, errorMessage: 'Caminho de documento fora da pasta permitida' }
    }

    if (!fs.existsSync(filePath)) {
      await sock.sendMessage(jid, { text: 'Encontrei essa opção, mas o arquivo não está disponível no servidor agora. Tente novamente mais tarde ou entre em contato com o suporte.' })
      errorLog('DOCUMENT_ERROR', 'Documento não encontrado no servidor', new Error('Arquivo não encontrado no servidor'), { user: jid, documentId: document.key, document })
      debugLog('Caminho absoluto de documento ausente', { eventType: 'DOCUMENT_ERROR', user: jid, documentId: document.key, absolutePath: filePath })
      return { success: false, absolutePath: filePath, errorMessage: 'Arquivo não encontrado no servidor' }
    }

    const baseRealPath = await fsPromises.realpath(path.resolve(config.documentsBasePath))
    const fileRealPath = await fsPromises.realpath(filePath)
    const realRelativePath = path.relative(baseRealPath, fileRealPath)
    const isRealPathInsideDocumentsDir = realRelativePath === '' || (!realRelativePath.startsWith('..') && !path.isAbsolute(realRelativePath))
    if (!isRealPathInsideDocumentsDir) {
      await sock.sendMessage(jid, { text: 'Encontrei essa opção, mas o arquivo aponta para um local não permitido. Entre em contato com o suporte.' })
      errorLog('DOCUMENT_ERROR', 'Documento usa link simbólico ou caminho real fora da pasta permitida', new Error('Caminho real fora de DOCUMENTS_DIR'), { user: jid, documentId: document.key, document })
      debugLog('Caminho real absoluto de documento bloqueado', { eventType: 'DOCUMENT_ERROR', user: jid, documentId: document.key, absolutePath: fileRealPath })
      return { success: false, absolutePath: filePath, errorMessage: 'Caminho real fora da pasta permitida' }
    }

    const stats = await fsPromises.stat(filePath)
    const maxSizeBytes = config.documentMaxSizeMb * 1024 * 1024
    if (stats.size > maxSizeBytes) {
      await sock.sendMessage(jid, { text: 'Encontrei essa opção, mas o arquivo está maior que o limite permitido para envio automático. Entre em contato com o suporte.' })
      errorLog('DOCUMENT_ERROR', 'Documento maior que o limite permitido', new Error('Documento maior que o limite permitido'), { user: jid, documentId: document.key, sizeBytes: stats.size, maxSizeBytes })
      return { success: false, absolutePath: filePath, errorMessage: 'Documento maior que o limite permitido' }
    }

    await sock.sendMessage(jid, {
      document: await fsPromises.readFile(filePath),
      mimetype: 'application/pdf',
      fileName: `${document.label}.pdf`
    })
    return { success: true, absolutePath: filePath }
  } catch (error) {
    errorLog('DOCUMENT_ERROR', 'Erro ao enviar documento', error, { user: jid, documentId: document.key, document })
    debugLog('Caminho absoluto de documento com erro de envio', { eventType: 'DOCUMENT_ERROR', user: jid, documentId: document.key, absolutePath: filePath })
    await sock.sendMessage(jid, { text: 'Encontrei a opção, mas não consegui enviar o documento agora. Tente novamente em alguns instantes ou entre em contato com o suporte.' })
    return { success: false, absolutePath: filePath, errorMessage: error instanceof Error ? error.message : 'Erro ao enviar documento' }
  }
}
