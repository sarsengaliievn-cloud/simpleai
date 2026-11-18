import { forCompany, type PrismaClient } from '@wa/db';
import type { AIProvider } from './ai/provider.js';
import { getAIFor, resolveAI, billingProvider } from './ai/factory.js';
import { hasBalance, recordUsage } from './billing.js';
import { moveDeal, CrmError, SILENT_REASON } from './crm.js';
import { resolveStageMap } from './shop-orders.js';

/**
 * ИИ сам переносит клиентов по этапам воронки — по смыслу переписки.
 * Менеджер открывает доску и сразу видит, кто «думает», кому отправили
 * каталог, кто обещал прийти в магазин.
 *
 * Правила, чтобы не мешать людям:
 *  — только вперёд по воронке (в «Отказ» — из любого открытого этапа);
 *  — сделку, которую человек переставил сам, ИИ сутки не трогает;
 *  — продажи («Заказ», «Купил» и этапы, куда ставит склад) — не его дело;
 *  — каждый перенос — в истории с причиной.
 */

type StageLite = { id: string; name: string; kind: string; position: number; aiHint?: string | null };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Подсказка по названию этапа — пока владелец не написал свою. «-» — ИИ этап не ставит. */
export function defaultStageHint(name: string, kind: string): string {
  const n = norm(name);
  if (kind === 'LOST') {
    return /нет[уа]? ответ|не отвеч|молч|пропал/.test(n)
      ? 'клиент прямо отказался (дорого, нет размера, купил в другом месте, передумал) или перестал отвечать'
      : 'клиент прямо отказался от покупки';
  }
  if (/менеджер/.test(n)) return '-'; // ставится сам при передаче менеджеру
  if (/график|адрес|режим|час(ы|ов) работ|доехат|где наход|локац/.test(n)) return 'клиент спрашивал адрес магазина, график работы или как доехать';
  if (/каталог|фото|подбор|вариант|подобр/.test(n)) return 'магазин отправил клиенту каталог, ссылку на модели или фото обуви';
  if (/дума|размышл|подума|ойла/.test(n)) return 'клиент получил цену или варианты и откладывает: «подумаю», «позже напишу», «посоветуюсь», «ойланып көрейін»';
  if (/жд[её]м оплат|ожида\S* оплат|оплат|сч[её]т|реквизит/.test(n)) return 'клиент согласился купить, ему дали реквизиты Kaspi или ссылку на оплату — ждём деньги';
  if (/прид[её]т|приедет|в магазин|самовывоз|забер[её]т|келеді/.test(n)) return 'клиент сказал, что придёт в магазин посмотреть или забрать сам';
  if (/консульт|вопрос|уточн|интерес/.test(n)) return 'клиент задаёт вопросы о товаре: размер, цена, наличие';
  return '';
}

export type StageOption = { id: string; name: string; kind: string; position: number; hint: string };

/**
 * Этапы, которые ИИ может ставить. Не может: «Новый», «Заказ», «Купил»,
 * этапы, куда двигает склад (оплачен, отправлен, выкуплен), и те, где
 * владелец поставил «-».
 */
/** Этапы продажи, куда ставит склад (оплачен, отправлен, выкуплен). */
export function skladStageIds(stages: StageLite[], orderStageMap?: unknown) {
  const map = resolveStageMap(stages, orderStageMap);
  return new Set([map.paid, map.assembled, map.shipped, map.completed].filter(Boolean) as string[]);
}

export function aiStageOptions(stages: StageLite[], orderStageMap?: unknown): StageOption[] {
  const sklad = skladStageIds(stages, orderStageMap);
  return stages
    .filter((s) => s.kind !== 'NEW' && s.kind !== 'ORDER' && s.kind !== 'WON' && !sklad.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position, hint: (s.aiHint?.trim() || defaultStageHint(s.name, s.kind)) }))
    .filter((s) => s.hint !== '-');
}

/** Можно ли ИИ перенести сделку с этапа `current` на `target`. */
export function aiMoveAllowed(current: StageLite, target: StageOption, sklad: Set<string>, manualStageAt: Date | null, now = new Date()) {
  if (current.id === target.id) return false;
  if (manualStageAt && now.getTime() - manualStageAt.getTime() < 24 * 3600_000) return false;
  // Сделка уже на этапе продажи или закрыта — её ведёт склад или человек.
  if (current.kind === 'WON' || current.kind === 'LOST' || current.kind === 'ORDER' || sklad.has(current.id)) return false;
  if (target.kind === 'LOST') return true;
  return target.position > current.position;
}

export type StageVerdict = { stageId: string | null; reason: string; lostReason: string };

const PROMPT = `Ты помогаешь отделу продаж магазина вести воронку. По переписке в WhatsApp определи, на каком этапе сейчас клиент.
Этапы (номер — название — когда ставить):
{STAGES}
Сейчас клиент на этапе: «{CURRENT}».

Верни строго один JSON (json): {"stage": N, "reason": "...", "lost_reason": ""}
stage — номер этапа, который лучше всего описывает, где клиент СЕЙЧАС, по последним сообщениям; 0 — если ни один не подходит лучше текущего или переписки мало.
reason — почему, до 12 слов, лучше коротко процитировать клиента или магазин.
lost_reason — только для отказа: причина в 2–4 словах («дорого», «нет размера», «купил в другом месте», «не отвечает»).
Не выдумывай: «отказ» — только если клиент сам отказался или явно перестал интересоваться.`;

export function stagePrompt(options: StageOption[], currentName: string) {
  const lines = options.map((o, i) => `${i + 1} — ${o.name}${o.hint ? ` — ${o.hint}` : ''}`).join('\n');
  return PROMPT.replace('{STAGES}', lines).replace('{CURRENT}', currentName);
}

export function parseStageVerdict(raw: string, options: StageOption[]): StageVerdict {
  const none = { stageId: null, reason: '', lostReason: '' };
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return none;
  try {
    const d = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const n = Math.round(Number(d.stage));
    const opt = n >= 1 && n <= options.length ? options[n - 1]! : null;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    return { stageId: opt?.id ?? null, reason: str(d.reason, 120), lostReason: str(d.lost_reason, 40) };
  } catch {
    return none;
  }
}

type Msg = { direction: string; authorType: string; type: string; text: string | null };

const MEDIA: Record<string, string> = { IMAGE: '[фото]', VIDEO: '[видео]', AUDIO: '[голосовое]', DOCUMENT: '[файл]', LOCATION: '[геолокация]', TEMPLATE: '[шаблон]' };

/** Переписка для ИИ: кто что сказал, медиа — пометкой (каталог часто уходит фотографиями). */
export function stageTranscript(messages: Msg[]) {
  return messages
    .filter((m) => m.authorType !== 'SYSTEM')
    .slice(-24)
    .map((m) => {
      const who = m.direction === 'INBOUND' ? 'Клиент' : m.authorType === 'AI' ? 'Магазин (бот)' : 'Магазин';
      const body = [MEDIA[m.type], m.text?.replace(/\s+/g, ' ').slice(0, 400)].filter(Boolean).join(' ');
      return body ? `${who}: ${body}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export async function classifyStage(ai: AIProvider, options: StageOption[], currentName: string, transcript: string) {
  const r = await ai.generate({
    system: stagePrompt(options, currentName),
    messages: [{ role: 'user', content: `Переписка:\n${transcript}` }],
    maxTokens: 160,
    temperature: 0,
  });
  return { verdict: parseStageVerdict(r.text, options), usage: r };
}

const QUIET_MS = 5 * 60_000;

/**
 * Обход раз в несколько минут: переписки, где что-то изменилось и уже
 * 5 минут тихо (обмен закончился), — ИИ смотрит и при необходимости
 * переносит сделку. Плюс «нет ответа»: клиент молчит N дней после нашего
 * сообщения.
 */
export async function runAiStages(prisma: PrismaClient, now = new Date(), limit = 150) {
  let moved = 0;
  let checked = 0;
  const deals = await prisma.deal.findMany({
    where: {
      archivedAt: null,
      stage: { kind: { in: ['NEW', 'WORK'] } },
      company: { aiStages: true },
      conversation: { lastMessageAt: { lte: new Date(now.getTime() - QUIET_MS), gte: new Date(now.getTime() - 3 * 24 * 3600_000) } },
    },
    select: {
      id: true, companyId: true, stageId: true, manualStageAt: true, aiStageAt: true,
      conversation: { select: { id: true, lastMessageAt: true } },
    },
    // Свежие переписки первыми; уже просмотренные отсеются ниже.
    orderBy: { conversation: { lastMessageAt: 'desc' } },
    take: limit * 4,
  });
  const due = deals.filter((d) => d.conversation && (!d.aiStageAt || d.aiStageAt < d.conversation.lastMessageAt)).slice(0, limit);

  const ctxCache = new Map<string, { options: StageOption[]; sklad: Set<string>; stages: StageLite[]; ai: AIProvider; choice: ReturnType<typeof resolveAI>; ok: boolean }>();
  for (const d of due) {
    const db = forCompany(prisma, d.companyId);
    let ctx = ctxCache.get(d.companyId);
    if (!ctx) {
      const [company, stages, config] = await Promise.all([
        prisma.company.findUnique({ where: { id: d.companyId }, select: { orderStageMap: true } }),
        db.pipelineStage.findMany({ orderBy: { position: 'asc' } }),
        db.aIConfiguration.findFirst(),
      ]);
      const choice = resolveAI(config);
      ctx = { options: aiStageOptions(stages, company?.orderStageMap), sklad: skladStageIds(stages, company?.orderStageMap), stages, ai: getAIFor(choice), choice, ok: await hasBalance(d.companyId) };
      ctxCache.set(d.companyId, ctx);
    }
    await db.deal.updateMany({ where: { id: d.id }, data: { aiStageAt: now } });
    const current = ctx.stages.find((s) => s.id === d.stageId);
    if (!ctx.ok || !current || ctx.options.length === 0) continue;
    // Сутки после ручного переноса — даже не тратим запрос.
    if (d.manualStageAt && now.getTime() - d.manualStageAt.getTime() < 24 * 3600_000) continue;
    if (ctx.sklad.has(current.id)) continue;

    const messages = await db.message.findMany({
      where: { conversationId: d.conversation!.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { direction: true, authorType: true, type: true, text: true },
    });
    const transcript = stageTranscript(messages.reverse());
    if (!transcript || !messages.some((m) => m.direction === 'INBOUND')) continue;

    try {
      checked += 1;
      const { verdict, usage } = await classifyStage(ctx.ai, ctx.options, current.name, transcript);
      await recordUsage(d.companyId, 'stages', {
        provider: billingProvider(ctx.choice), model: ctx.choice.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      }, d.conversation!.id);
      const target = ctx.options.find((o) => o.id === verdict.stageId);
      if (!target || !aiMoveAllowed(current, target, ctx.sklad, d.manualStageAt, now)) continue;
      await moveDeal(db, {
        dealId: d.id,
        stageId: target.id,
        aiReason: verdict.reason || 'по переписке',
        lostReason: target.kind === 'LOST' ? verdict.lostReason || verdict.reason || 'Отказался' : null,
      });
      moved += 1;
    } catch (e) {
      if (e instanceof CrmError) continue;
      console.error(`[stages] ${d.id}:`, (e as Error).message);
    }
  }

  const silent = await moveSilentToLost(prisma, now);
  return { checked, moved, silent };
}

/** «Нет ответа»: наше сообщение последнее, клиент молчит N дней. */
async function moveSilentToLost(prisma: PrismaClient, now: Date) {
  const companies = await prisma.company.findMany({ where: { aiStages: true }, select: { id: true, noAnswerDays: true, orderStageMap: true } });
  let moved = 0;
  for (const c of companies) {
    const days = Math.min(30, Math.max(1, c.noAnswerDays || 3));
    const db = forCompany(prisma, c.id);
    const deals = await db.deal.findMany({
      where: {
        archivedAt: null,
        stage: { kind: { in: ['NEW', 'WORK'] } },
        conversation: { lastMessageAt: { lte: new Date(now.getTime() - days * 24 * 3600_000), gte: new Date(now.getTime() - (days + 30) * 24 * 3600_000) } },
        OR: [{ remindAt: null }, { remindAt: { lte: now } }],
      },
      select: { id: true, stageId: true, manualStageAt: true, conversationId: true },
      take: 200,
    });
    if (!deals.length) continue;
    const stages = await db.pipelineStage.findMany({ orderBy: { position: 'asc' } });
    const options = aiStageOptions(stages, c.orderStageMap);
    const sklad = skladStageIds(stages, c.orderStageMap);
    const lost = options.filter((o) => o.kind === 'LOST');
    const target = lost.find((o) => /нет[уа]? ответ|не отвеч|молч|пропал/.test(norm(o.name))) ?? lost[0];
    if (!target) continue;
    for (const d of deals) {
      const current = stages.find((s) => s.id === d.stageId);
      if (!current || !aiMoveAllowed(current, target, sklad, d.manualStageAt, now)) continue;
      const last = await db.message.findFirst({
        where: { conversationId: d.conversationId!, authorType: { not: 'SYSTEM' } },
        orderBy: { createdAt: 'desc' },
        select: { direction: true },
      });
      if (last?.direction !== 'OUTBOUND') continue; // последнее слово за клиентом — это не молчание, а «нам не ответили»
      try {
        await moveDeal(db, { dealId: d.id, stageId: target.id, aiReason: `клиент молчит ${days} дн.`, lostReason: SILENT_REASON });
        moved += 1;
      } catch (e) {
        if (!(e instanceof CrmError)) console.error(`[stages] silent ${d.id}:`, (e as Error).message);
      }
    }
  }
  return moved;
}

