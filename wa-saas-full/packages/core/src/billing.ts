import { prisma } from '@wa/db';

/**
 * Баланс ИИ. Каждый вызов модели стоит денег: считаем себестоимость по цене
 * модели в долларах, переводим в тенге по курсу и умножаем на наценку.
 * Списание — в тиынах (1 ₸ = 100), чтобы копейки не терялись на округлении.
 */

export type Provider = 'gemini' | 'openai';

export type ModelInfo = {
  id: string;
  provider: Provider;
  label: string;
  note: string;
  /** Цена за 1 млн токенов, $. */
  inUsd: number;
  outUsd: number;
};

/** Модели на выбор. Цены — по умолчанию, владелец платформы может их поменять. */
export const MODELS: ModelInfo[] = [
  { id: 'gemini-3.6-flash', provider: 'gemini', label: 'Gemini 3.6 Flash', note: 'Быстрый, хорошо понимает казахский', inUsd: 0.75, outUsd: 3.75 },
  { id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', note: 'Дешевле, чуть проще в ответах', inUsd: 0.3, outUsd: 2.5 },
  { id: 'gpt-5-mini', provider: 'openai', label: 'ChatGPT 5 mini', note: 'Баланс цены и качества', inUsd: 0.25, outUsd: 2 },
  { id: 'gpt-5-nano', provider: 'openai', label: 'ChatGPT 5 nano', note: 'Самый дешёвый, для простых вопросов', inUsd: 0.05, outUsd: 0.4 },
  { id: 'gpt-5', provider: 'openai', label: 'ChatGPT 5', note: 'Самый умный, дороже остальных', inUsd: 1.25, outUsd: 10 },
];

/** Эмбеддинги (поиск по базе знаний), $ за 1 млн токенов. */
export const EMBED_USD: Record<Provider, number> = { gemini: 0.15, openai: 0.02 };
/** Расшифровка голосовых, $ за минуту. */
export const VOICE_USD_PER_MIN: Record<Provider, number> = { gemini: 0.002, openai: 0.003 };

export type BillingSettings = {
  /** Курс: сколько тенге за доллар. */
  usdKzt: number;
  /** Наценка: 2 — клиент платит вдвое больше себестоимости. */
  markup: number;
  /** Бонус новой компании на пробу, ₸. */
  welcomeBonusKzt: number;
  /** Переопределённые цены моделей: id → { inUsd, outUsd }. */
  prices: Record<string, { inUsd: number; outUsd: number }>;
  /** Как пополнить — текст для клиентов (номер Kaspi, реквизиты). */
  topupInstructions: string;
};

export const DEFAULT_SETTINGS: BillingSettings = {
  usdKzt: 520,
  markup: 2,
  welcomeBonusKzt: 1000,
  prices: {},
  topupInstructions: 'Переведите сумму на Kaspi владельцу платформы и нажмите «Запросить пополнение» — баланс зачислят после проверки платежа.',
};

let cached: { at: number; value: BillingSettings } | null = null;

/** Настройки платформы, кэш на минуту — читаются на каждом ответе бота. */
export async function billingSettings(): Promise<BillingSettings> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const row = await prisma.platformSetting.findUnique({ where: { key: 'billing' } });
  const value = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<BillingSettings> | null) ?? {}) };
  cached = { at: Date.now(), value };
  return value;
}

export async function saveBillingSettings(patch: Partial<BillingSettings>) {
  const value = { ...(await billingSettings()), ...patch };
  await prisma.platformSetting.upsert({
    where: { key: 'billing' },
    create: { key: 'billing', value: value as never },
    update: { value: value as never },
  });
  cached = null;
  return value;
}

export function modelInfo(id: string, settings?: Pick<BillingSettings, 'prices'>): ModelInfo | null {
  const base = MODELS.find((m) => m.id === id);
  if (!base) return null;
  const override = settings?.prices[id];
  return override ? { ...base, ...override } : base;
}

/** Есть ли на сервере ключ провайдера — без ключа модель не предлагаем. */
export function providerAvailable(provider: Provider) {
  return provider === 'gemini' ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENAI_API_KEY);
}

export type UsageInput = {
  provider: Provider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  embedTokens?: number;
  audioSeconds?: number;
};

/** Себестоимость вызова в долларах. Неизвестная модель считается по самой дорогой цене. */
export function costUsd(usage: UsageInput, settings: Pick<BillingSettings, 'prices'>): number {
  const fallback = MODELS.reduce((a, b) => (a.outUsd > b.outUsd ? a : b));
  const m = modelInfo(usage.model, settings) ?? fallback;
  return (
    ((usage.inputTokens ?? 0) * m.inUsd + (usage.outputTokens ?? 0) * m.outUsd) / 1_000_000 +
    ((usage.embedTokens ?? 0) * EMBED_USD[usage.provider]) / 1_000_000 +
    ((usage.audioSeconds ?? 0) / 60) * VOICE_USD_PER_MIN[usage.provider]
  );
}

/** Сколько списать с клиента, тиыны. Округляем вверх: любой ненулевой вызов — минимум 1 тиын. */
export function chargeTiyn(usd: number, settings: Pick<BillingSettings, 'usdKzt' | 'markup'>): number {
  if (usd <= 0) return 0;
  return Math.max(1, Math.ceil(usd * settings.usdKzt * settings.markup * 100));
}

/** Тиыны → «1 234,56 ₸», для крупных сумм без копеек. */
export function formatTiyn(tiyn: number) {
  const kzt = tiyn / 100;
  const abs = Math.abs(kzt);
  const text = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: abs < 100 && abs % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: abs < 100 ? 2 : 0,
  }).format(kzt).replace(/[  ]/g, ' ');
  return `${text} ₸`;
}

/** Деньги ещё есть? Бот отвечает только при положительном балансе. */
export async function hasBalance(companyId: string): Promise<boolean> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { balanceTiyn: true } });
  return (company?.balanceTiyn ?? 0) > 0;
}

export type UsageKind = 'reply' | 'playground' | 'knowledge' | 'voice';

/**
 * Записать расход и списать с баланса — одной транзакцией. Баланс может
 * немного уйти в минус последним вызовом: прерывать готовый ответ хуже.
 */
export async function recordUsage(
  companyId: string,
  kind: UsageKind,
  usage: UsageInput,
  conversationId?: string | null,
) {
  const settings = await billingSettings();
  const usd = costUsd(usage, settings);
  const charge = chargeTiyn(usd, settings);
  await prisma.$transaction([
    prisma.aiUsage.create({
      data: {
        companyId,
        kind,
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        embedTokens: usage.embedTokens ?? 0,
        audioSeconds: Math.round(usage.audioSeconds ?? 0),
        costMicroUsd: Math.round(usd * 1_000_000),
        chargeTiyn: charge,
        conversationId: conversationId ?? null,
      },
    }),
    prisma.company.update({ where: { id: companyId }, data: { balanceTiyn: { decrement: charge } } }),
  ]);
  return charge;
}

/**
 * Зачислить на баланс (пополнение, бонус) или поправить вручную.
 * Пополнение запоминается — от него считается порог «осталось меньше 10%».
 */
export async function creditBalance(
  companyId: string,
  input: { kind: 'topup' | 'bonus' | 'adjust'; amountTiyn: number; note?: string | null; actorEmail?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.update({
      where: { id: companyId },
      data: {
        balanceTiyn: { increment: input.amountTiyn },
        ...(input.kind === 'topup' || input.kind === 'bonus' ? { lastTopupTiyn: input.amountTiyn } : {}),
      },
      select: { balanceTiyn: true },
    });
    await tx.balanceTransaction.create({
      data: {
        companyId,
        kind: input.kind,
        amountTiyn: input.amountTiyn,
        balanceAfterTiyn: company.balanceTiyn,
        note: input.note ?? null,
        actorEmail: input.actorEmail ?? null,
      },
    });
    return company.balanceTiyn;
  });
}

/** Осталось мало: меньше 10% от последнего пополнения (или ноль). */
export function balanceLow(balanceTiyn: number, lastTopupTiyn: number) {
  if (balanceTiyn <= 0) return true;
  return lastTopupTiyn > 0 && balanceTiyn < lastTopupTiyn * 0.1;
}

/** Грубая длительность голосового по размеру: Opus в WhatsApp ≈ 16 кбит/с. */
export function estimateAudioSeconds(bytes: number) {
  return Math.max(1, Math.round((bytes * 8) / 16_000));
}
