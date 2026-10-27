/** Адрес Graph API. Переопределяется для тестового стенда или прокси. */
export function graphBase() {
  return (process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v24.0').replace(/\/$/, '');
}
