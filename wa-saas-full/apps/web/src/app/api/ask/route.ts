import { requireCompany } from '@/lib/session';
import { answerQuestion } from '@wa/core';

export const dynamic = 'force-dynamic';

/**
 * Один вопрос к ассистенту без отправки в WhatsApp.
 * Используется и тестовым чатом, и отладкой поиска по базе знаний.
 */
export async function POST(request: Request) {
  const { company, db } = await requireCompany();
  const body = (await request.json()) as { question?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> };

  const question = (body.question ?? '').trim();
  if (!question) return Response.json({ error: 'Пустой вопрос' }, { status: 400 });

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
      history: body.history?.slice(-8),
    });

    return Response.json({
      answer: result.answer,
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
