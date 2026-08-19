/** Имена очередей. Единый источник правды для web и worker. */
export const QUEUES = {
  inboundMessage: 'inbound-message',
  outboundMessage: 'outbound-message',
  ingestDocument: 'ingest-document',
} as const;

export interface InboundMessageJob {
  webhookEventId: string;
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
