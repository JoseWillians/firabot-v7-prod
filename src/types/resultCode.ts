export const BotResultCode = {
  OK: 200,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const

export type BotResultCodeValue = typeof BotResultCode[keyof typeof BotResultCode]

export interface BotOperationResult<T = undefined> {
  success: boolean
  code: BotResultCodeValue
  message: string
  data?: T
}
