import { requireCompany } from '@/lib/session';
import { answerQuestion, splitReply } from '@wa/core';

export const dynamic = 'force-dynamic';

type Body = { question?: unknown; history?: unknown };

/**
 * Один вопрос к ассистенту без отправки в WhatsApp.
 * Используется и тестовым чатом, и отладкой поиска по базе знаний.
 */
export async function POST(request: Request) {
  const { company, db } = await requireCompany();

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

  try {
    const result = await answerQuestion({
      companyId: company.id,
      company,
      config,
      question,
      history,
    });

    return Response.json({
      answer: result.answer,
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
    const message = (error as Error).message.includes('API_KEY')
      ? 'Не задан ключ AI-провайдера в .env'
      : 'Ассистент сейчас недоступен. Попробуйте ещё раз.';
    return Response.json({ error: message }, { status: 503 });
  }
}
