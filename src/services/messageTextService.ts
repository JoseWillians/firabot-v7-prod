import { proto } from 'baileys'

/**
 * Centraliza a extração de texto de mensagens do WhatsApp.
 * O Baileys representa textos, respostas e futuramente captions em formatos
 * diferentes; manter isso em um serviço evita espalhar condicionais pelo
 * roteador principal de conversa.
 */
export function extractMessageText(message: proto.IMessage | null | undefined): string {
  if (!message) return ''

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
  ).trim()
}
