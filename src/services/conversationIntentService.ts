export type ConversationIntent = 'main' | 'end' | 'documents' | 'course' | 'support'

function normalizeIntentText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const intentPhrases: Record<ConversationIntent, Set<string>> = {
  main: new Set(['voltar', 'voltar ao menu', 'menu principal']),
  end: new Set(['sair', 'terminar', 'finalizar', 'encerrar atendimento', 'terminar conversa']),
  documents: new Set(['documento', 'documentos', 'quero documento', 'quero documentos', 'preciso de documento', 'preciso de documentos']),
  course: new Set(['ppc', 'ppc do curso', 'quero ppc', 'projeto pedagogico', 'projeto pedagogico do curso']),
  support: new Set(['suporte', 'falar com suporte', 'ajuda humana', 'atendimento humano'])
}

/**
 * Reconhece somente frases previamente aprovadas. Uma lista fechada melhora a
 * experiência sem transformar qualquer texto livre em navegação inesperada.
 */
export function detectConversationIntent(value: string): ConversationIntent | null {
  const normalized = normalizeIntentText(value)
  for (const [intent, phrases] of Object.entries(intentPhrases) as [ConversationIntent, Set<string>][]) {
    if (phrases.has(normalized)) return intent
  }
  return null
}
