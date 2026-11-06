import { isWindowOpen } from '@wa/core';
import type { TenantClient } from '@wa/db';

/** Переписка для ThreadView — одинаково в «Диалогах» и в карточке сделки. */
export async function loadThread(db: TenantClient, where: { id: string; assigneeId?: string }) {
  const c = await db.conversation.findFirst({
    where,
    include: { customer: true, messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
  });
  if (!c) return null;
  return {
    customerId: c.customer.id,
    conversation: {
      id: c.id,
      mode: c.mode,
      windowOpen: isWindowOpen(c.windowExpiresAt),
      windowExpiresAt: c.windowExpiresAt,
      customerName: c.customer.name || `+${c.customer.waId}`,
      customerPhone: c.customer.phone,
      customerCity: c.customer.city,
      closedReason: c.status === 'CLOSED' ? c.closeReason ?? 'done' : null,
    },
    messages: c.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      authorType: m.authorType,
      text: m.text,
      type: m.type,
      status: m.status,
      errorCode: m.errorCode,
      createdAt: m.createdAt,
      fromPhone: (m.metadata as { source?: string } | null)?.source === 'phone',
      media: (m.metadata as { mediaId?: string } | null)?.mediaId
        ? { fileName: (m.metadata as { fileName?: string }).fileName ?? null, mime: m.mediaMimeType }
        : null,
    })),
  };
}
