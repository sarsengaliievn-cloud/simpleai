import { requireCompany } from '@/lib/session';
import { answerQuestion, splitReply, hasBalance, recordUsage, billingProvider, formatTiyn, aiErrorReason, orderQuestion, orderConfirmation } from '@wa/core';

export const dynamic = 'force-dynamic';

type Body = { question?: unknown; history?: unknown };

/**
 * Один вопрос к ассистенту без отправки в WhatsApp.
 * Используется и тестовым чатом, и отладкой поиска по базе знаний.
 */
export async function POST(request: Request) {
  const { company, db } = await requireCompany('ai:manage');

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return Response.json({ error: 'Пустой вопрос' }, { status: 400 });
  if (question.length > 2000) return Response.json({ error: 'Слишком длинный вопрос' }, { status: 400 });

  // История приходит из браузера — доверять её форме нельзя.
  const history = Array.isArray(body.history)
    ? body.history
        .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
          !!m && typeof m === 'object' &&
          ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
          typeof (m as { content?: unknown }).content === 'string')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    : [];

  const config = await db.aIConfiguration.findFirst();
  if (!config) {
    return Response.json({ error: 'Ассистент ещё не настроен — откройте раздел «Ассистент».' }, { status: 400 });
  }

  if (!(await hasBalance(company.id))) {
    return Response.json({ error: 'Баланс ИИ закончился — пополните его в разделе «Баланс».' }, { status: 402 });
  }

  try {
    const result = await answerQuestion({
      companyId: company.id,
      company,
      config,
      question,
      history,
      catalog: config.catalogUrl.trim()
        ? { url: config.catalogUrl.trim(), productUrl: config.catalogProductUrl.trim() || null, photoUrl: config.catalogPhotos ? config.catalogPhotoUrl.trim() || null : null }
        : null,
    });
    if (config.lastErrorAt) await db.aIConfiguration.updateMany({ data: { lastErrorAt: null, lastError: null } });

    const charged = await recordUsage(company.id, 'playground', {
      provider: billingProvider(result.ai),
      model: result.ai.model,
      ...result.usage,
    });

    // Готов купить: как в WhatsApp — один раз уточнить, потом передать менеджеру.
    if (result.order) {
      const lastBot = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
      const asked = /^(Хорошо! Подскажите|Жақсы! Нақтылап)/.test(lastBot);
      const ask = result.order.missing.length > 0 && !asked;
      const text = ask ? orderQuestion(result.order) : orderConfirmation(result.order.lang);
      return Response.json({
        answer: text,
        cost: formatTiyn(charged),
        parts: [text],
        confidence: 100,
        needsHuman: false,
        threshold: config.confidenceThreshold,
        hits: [],
        understanding: result.understanding,
        order: ask ? null : { summary: result.order.summary, missing: result.order.missing },
      });
    }

    return Response.json({
      understanding: result.understanding,
      catalog: result.catalog,
      photos: result.photos ?? [],
      answer: result.answer,
      /** Сколько стоил этот ответ — видно в тестовом чате. */
      cost: formatTiyn(charged),
      // Как ответ уйдёт в WhatsApp — тестовый чат показывает те же части.
      parts: config.splitReplies && result.answer ? splitReply(result.answer, config.splitMaxChars) : [result.answer],
      confidence: result.confidence,
      modelConfidence: result.modelConfidence,
      topScore: Math.round(result.topScore * 100),
      needsHuman: result.needsHuman,
      threshold: config.confidenceThreshold,
      hits: result.hits.map((h) => ({
        title: h.documentTitle,
        ordinal: h.ordinal,
        score: Math.round(h.score * 100),
        preview: h.content.slice(0, 220),
      })),
    });
  } catch (error) {
    // Наружу — человеческий текст, подробности в логи.
    console.error('[ask] сбой', error);
    const raw = (error as Error).message ?? '';
    const reason = aiErrorReason(raw, config.aiModel);
    await db.aIConfiguration.updateMany({ data: { lastErrorAt: new Date(), lastError: reason } }).catch(() => {});
    // Владельцу — причина и короткая техническая деталь: так сразу видно, что чинить.
    return Response.json({ error: reason, detail: raw.slice(0, 300) }, { status: 503 });
  }
}

