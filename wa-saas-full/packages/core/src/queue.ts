/** Имена очередей. Единый источник правды для web и worker. */
export const QUEUES = {
  inboundMessage: 'inbound-message',
  outboundMessage: 'outbound-message',
  ingestDocument: 'ingest-document',
  /** Отложенный ответ ассистента: ждём, пока клиент допишет серию сообщений. */
  aiReply: 'ai-reply',
} as const;

export interface InboundMessageJob {
  webhookEventId: string;
}

export interface AiReplyJob {
  companyId: string;
  conversationId: string;
  /** id сообщения клиента в нашей базе. Если после него пришло ещё — задача молчит. */
  inboundMessageId: string;
}

export interface OutboundMessageJob {
  companyId: string;
  conversationId: string;
  messageId: string;
}

export interface IngestDocumentJob {
  companyId: string;
  documentId: string;
  text: string;
}
