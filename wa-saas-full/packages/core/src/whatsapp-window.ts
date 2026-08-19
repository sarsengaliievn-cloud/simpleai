const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Окно обслуживания открывается заново каждым входящим сообщением клиента. */
export function windowExpiryFrom(inboundAt: Date): Date {
  return new Date(inboundAt.getTime() + WINDOW_MS);
}

export function isWindowOpen(windowExpiresAt: Date | null, now: Date = new Date()): boolean {
  return windowExpiresAt !== null && windowExpiresAt.getTime() > now.getTime();
}

/**
 * Вне окна Meta принимает только утверждённый шаблон. Любая отправка
 * свободного текста должна пройти через эту проверку — иначе клиенту
 * прилетит ошибка от API, а номеру просядет качество.
 */
export function assertCanSendFreeText(windowExpiresAt: Date | null, now: Date = new Date()): void {
  if (!isWindowOpen(windowExpiresAt, now)) {
    throw new Error(
      'Окно 24 часов закрыто: свободный текст отправить нельзя, используй шаблонное сообщение.',
    );
  }
}
