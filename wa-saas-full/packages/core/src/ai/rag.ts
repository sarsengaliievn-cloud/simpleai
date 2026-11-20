import { searchChunks, type SearchHit } from '@wa/db';
import { getAIFor, resolveAI, type AIChoice } from './factory.js';
import { estimateTokens } from './chunk.js';
import { buildSystemPrompt, type AIConfigLike } from './prompt.js';
import type { ChatMessage } from './provider.js';
import { understandMessage, type Understanding } from './understand.js';
import {
  loadCatalog, searchCatalog, catalogBlock, storesLine, sizeAvailability, photoLink, productLink, shownProductIds,
  type Catalog, type CatalogMatch, type CatalogSource,
} from '../catalog.js';

export type AnswerResult = {
  answer: string;
  /** Итоговая уверенность 0..100 после проверки по найденным фрагментам. */
  confidence: number;
  modelConfidence: number;
  topScore: number;
  needsHuman: boolean;
  hits: SearchHit[];
  /** Расход для баланса: генерация и эмбеддинг вопроса. */
  usage: { inputTokens: number; outputTokens: number; embedTokens: number };
  /** Каким ИИ отвечали — для списания по цене модели. */
  ai: AIChoice;
  /** Как бот понял сообщение: переписанный вопрос, намерение, модель, размер. */
  understanding?: Understanding | null;
  /** Что нашлось в каталоге склада. */
  catalog?: { mode: CatalogMatch['mode']; count: number; error?: string } | null;
  /** Клиент готов купить: что известно и чего не хватает. */
  order?: OrderDraft | null;
  /** Фото подобранных моделей — бот отправит их после ответа. */
  photos?: Array<{ url: string; caption: string }>;
  /** Пишет не покупатель (сотрудничество, реклама, вакансия) — про товары не отвечаем. */
  partner?: { lang: 'ru' | 'kk' } | null;
  /** Возврат, обмен, брак — сразу менеджеру, без ответа бота. */
  managerOnly?: boolean;
};

export type OrderField = 'model' | 'size' | 'city';
export type OrderDraft = {
  missing: OrderField[];
  lang: 'ru' | 'kk';
  /** Для менеджера: модель, размер, цена, город, доставка, оплата, наличие. */
  summary: string;
  /** В сделку: «Зимние ботинки (арт. 1234), размер 41». */
  product: string;
  amount: number | null;
  /** В сделку: «Астана · Казпочта · Kaspi». */
  comment: string;
};

/** Ниже этого совпадения считаем, что в базе знаний ответа просто нет. */
const MIN_RELEVANCE = 0.35;

/*
 * Приветствие и «спасибо» в базе знаний не ищем: ответа там нет, и раньше
 * бот на «Здравствуйте» звал менеджера. Признаём такую реплику, только если
 * в ней есть приветствие или благодарность и кроме них ничего — «да» или
 * «ок» в ответ на вопрос бота сюда не попадут.
 */
const SMALLTALK_CORE = new Set([
  'привет', 'приветствую', 'здравствуйте', 'здравствуй', 'здрасте', 'здрасьте', 'добрый', 'доброе', 'доброй',
  'салем', 'сәлем', 'салам', 'сәлеметсіз', 'сәлеметсізбе', 'салеметсиз', 'салеметсизбе', 'саламатсызба',
  'ассаляму', 'ассалям', 'ассалам', 'ассаламу', 'алейкум', 'алейкуму', 'уалейкум', 'қайырлы', 'кайырлы',
  'саламатсыз', 'саламатсызба', 'сәлеметсіздер', 'салеметсиздер', 'амансыз', 'амансызба', 'армысыз', 'армысыздар', 'уағалейкум',
  'ассалаумағалейкум', 'ассалаумагалейкум', 'ассаламағалейкум', 'ассаламагалейкум', 'ассалаумалейкум', 'салем', 'салеметсизбе',
  'salem', 'salam', 'salemetsiz', 'salemetsizbe', 'salametsiz', 'assalaumagaleikum', 'assalamualaikum', 'rahmet', 'rakhmet', 'raxmet',
  'hi', 'hello', 'hey', 'спасибо', 'спс', 'благодарю', 'рахмет', 'рақмет', 'thanks', 'thank',
  'дела', 'қалайсыз', 'калайсыз', 'қалай', 'калай', 'жағдай', 'жагдай',
]);
const SMALLTALK_EXTRA = new Set([
  'день', 'вечер', 'утро', 'ночи', 'таң', 'кеш', 'күн', 'тан', 'кун', 'как', 'ваши', 'у', 'вас', 'вам', 'большое',
  'огромное', 'you', 'very', 'much', 'ок', 'окей', 'ok', 'хорошо', 'понятно', 'ясно', 'отлично', 'супер', 'ладно',
  'пожалуйста', 'и', 'еще', 'ещё', 'всё', 'все', 'норм', 'класс', 'круто', 'жақсы', 'жаксы', 'көп', 'коп', 'бе', 'ба', 'ме', 'ма',
  'be', 'ba', 'me', 'ma', 'kop', 'kөp', 'zhaksy', 'jaksy', 'ok', 'okay', 'уалейкум', 'алейкум', 'ассалам', 'сау', 'болыңыз', 'болыныз',
]);

export function isSmallTalk(text: string): boolean {
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]+/gu) ?? [];
  if (words.length === 0 || words.length > 8) return false;
  const core = (w: string) => SMALLTALK_CORE.has(w) || SMALLTALK_CORE.has(w.replace(/е/g, 'ё'));
  const extra = (w: string) => SMALLTALK_EXTRA.has(w) || SMALLTALK_EXTRA.has(w.replace(/е/g, 'ё'));
  return words.some(core) && words.every((w) => core(w) || extra(w));
}

const SMALLTALK_NOTE =
  'Фрагментов базы знаний для этого сообщения нет: клиент просто здоровается или благодарит. ' +
  'Ответь коротко и тепло на его языке: поздоровайся или ответь на благодарность и спроси, чем можешь помочь. ' +
  'Ничего не говори о товарах, ценах, наличии и доставке. Верни confidence 100 и needs_human = false.';

/**
 * Возврат, обмен, брак, претензия — решает человек. Бот здесь только вредит:
 * пообещает лишнее или, как было, ответит «чем могу помочь?».
 */
export const MANAGER_ONLY_Q = /возврат|вернуть|верните|обмен|обменя|поменять|брак|претензи|не подош|не подход|қайтар|ауыстыр|алмастыр|сәйкес кел|сай кел|үлкен бол|кіші бол|улкен бол|киши бол|үлкен боп|кіші боп|ақау|акау|жыртыл/i;

/** Казахские буквы — точно казахский, даже если половина слов русские («41 размер бірақ үлкен»). */
const KK_LETTERS = /[әғқңөұүһі]/i;
export function clientLang(text: string, guess?: 'ru' | 'kk'): 'ru' | 'kk' | undefined {
  return KK_LETTERS.test(text) ? 'kk' : guess;
}

/** Вопрос о своём заказе: «где моя посылка», «когда отправите», «тапсырысым қайда». */
export const ORDER_STATUS_Q = /заказ|посылк|трек|отправ|доставк|придёт|придет|где мо[йяиё]|тапсырыс|сәлемдеме|посылка|жеткіз|жіберд|қашан кел|почт/i;

export async function answerQuestion(params: {
  companyId: string;
  company: { name: string; description?: string | null; city?: string | null };
  config: AIConfigLike & { confidenceThreshold: number; aiProvider?: string | null; aiModel?: string | null };
  question: string;
  history?: ChatMessage[];
  /** Каталог склада: наличие, размеры и цены берутся отсюда. */
  catalog?: CatalogSource | null;
  /** Заказы клиента из склада (shopOrdersBlock) — для вопросов «где мой заказ». */
  orders?: string | null;
}): Promise<AnswerResult> {
  const choice = resolveAI(params.config);
  const ai = getAIFor(choice);

  if (isSmallTalk(params.question)) {
    const result = await ai.generate({
      system: buildSystemPrompt(params.config, params.company),
      messages: normalizeHistory([
        ...(params.history ?? []),
        { role: 'user', content: `${SMALLTALK_NOTE}\n\nСообщение клиента: ${params.question}` },
      ]),
    });
    const parsed = parseAnswer(result.text);
    return {
      answer: parsed.answer,
      confidence: parsed.answer ? parsed.confidence : 0,
      modelConfidence: parsed.confidence,
      topScore: 0,
      needsHuman: !parsed.answer || parsed.needsHuman,
      hits: [],
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, embedTokens: 0 },
      ai: choice,
    };
  }

  // ── 1. Понять, что спрашивают ────────────────────────────
  // Разговорный казахский, смесь языков, «а 42 есть?» со ссылкой на прошлое —
  // модель переписывает вопрос нормально и достаёт модель, размер, город.
  const history = params.history ?? [];
  let inputTokens = 0;
  let outputTokens = 0;
  let u: Understanding | null = null;
  try {
    const r = await understandMessage(ai, params.question, history);
    u = r.understanding;
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
  } catch (error) {
    // Не разобрали — отвечаем по исходному тексту, как раньше.
    console.warn('[ai] разбор сообщения не удался:', (error as Error).message.slice(0, 200));
  }
  const query = u?.query && u.query !== params.question ? u.query : params.question;

  // Не покупатель: маркетплейс, реклама, поставщик, вакансия. Рассказывать
  // ему цены и оплату бессмысленно — вежливо отвечаем и отдаём людям.
  if (u?.intent === 'partner') {
    return {
      answer: '', confidence: 100, modelConfidence: 100, topScore: 0, needsHuman: false, hits: [],
      usage: { inputTokens, outputTokens, embedTokens: 0 }, ai: choice,
      understanding: u, partner: { lang: u.lang },
    };
  }

  // Возврат, обмен, брак: условия из базы бот назовёт, но решает менеджер —
  // после ответа диалог всё равно уходит человеку.
  const managerOnly = MANAGER_ONLY_Q.test(params.question);

  // ── 2. Склад ───────────────────────────────────────────────
  let catalog: Catalog | null = null;
  let match: CatalogMatch | null = null;
  let catalogError: string | undefined;
  // Склад нужен, если клиент спрашивает о наличии, просит подобрать, берёт —
  // или просто прислал карточку модели с сайта (ссылка, артикул).
  const linksModel = /#p=|артикул|\bарт\.?\s*[\w-]{2,}/i.test(params.question)
    || (!!params.catalog?.productUrl && params.catalog.productUrl.includes('{id}') && params.question.includes(params.catalog.productUrl.split('{id}')[0]!));
  const wantsCatalog = linksModel || (!!u && (['stock', 'pick', 'buy'].includes(u.intent) || !!u.article || !!u.model || !!u.size || !!u.kind));
  if (params.catalog?.url && wantsCatalog) {
    try {
      catalog = await loadCatalog(params.catalog);
      const context = [...history.map((m) => m.content), params.question].join('\n');
      const shown = shownProductIds(history.filter((m) => m.role === 'assistant').map((m) => m.content), params.catalog.productUrl);
      match = searchCatalog(catalog, {
        article: u?.article, model: u?.model, kind: u?.kind, size: u?.size, gender: u?.gender, season: u?.season,
        color: u?.color, maxPrice: u?.maxPrice, context, exclude: shown, pick: u?.intent === 'pick',
      }, params.catalog.productUrl);
      // Подбор показываем, только когда клиент о нём просил; карточка модели — всегда.
      if (match.mode === 'pick' && u && !['stock', 'pick', 'buy'].includes(u.intent)) match = { ...match, mode: 'none', items: [] };
    } catch (error) {
      catalogError = (error as Error).message.slice(0, 200);
      console.warn('[ai] каталог недоступен:', catalogError);
    }
  }
  const catalogInfo = params.catalog?.url && wantsCatalog
    ? { mode: match?.mode ?? 'none', count: match?.items.length ?? 0, ...(catalogError ? { error: catalogError } : {}) }
    : null;

  // ── 3. Готов купить — собрать заказ для менеджера ─────────
  // Всё известно (модель, размер, город) — сразу менеджеру. Не хватает —
  // сначала база знаний: там может быть ответ владельца на это самое
  // сообщение («хочу по акции за 38 900» → подарки и «какой размер?»).
  // Базе нечего сказать — уточняем недостающее сами.
  const order = u?.intent === 'buy' ? draftOrder(u, catalog, match, params.catalog ?? null) : null;
  const orderResult = (spent = { input: 0, output: 0, embed: 0 }): AnswerResult => ({
    answer: '', confidence: 100, modelConfidence: 100, topScore: 0, needsHuman: false, hits: [],
    usage: { inputTokens: inputTokens + spent.input, outputTokens: outputTokens + spent.output, embedTokens: spent.embed }, ai: choice,
    understanding: u, catalog: catalogInfo, order,
  });
  if (order && order.missing.length === 0) return orderResult();

  // ── 4. База знаний: ищем и по исходному тексту, и по переписанному ──
  // Серия из нескольких сообщений («42 размер» / «классика» / «рассрочка
  // есть?») — каждое ищем отдельно, иначе вопрос про рассрочку тонет в общем
  // смысле и бот на него не отвечает.
  // Приветствия («Қайырлы кеш», «Здравствуйте») в поиск не берём: иначе
  // находится заметка, которая тоже начинается с «Саламатсыз ба!», и бот
  // отвечает ценой вместо ответа на вопрос о доставке.
  const lines = params.question.split('\n').map((l) => l.trim()).filter((l) => l.length >= 3 && !isSmallTalk(l));
  const asked = lines.join('\n') || params.question;
  const texts = [...new Set([query, asked, ...(lines.length > 1 ? lines.slice(-4) : [])])];
  const embedTokens = texts.reduce((sum, t) => sum + estimateTokens(t), 0);
  const embeddings = await ai.embed(texts);
  const found = new Map<string, SearchHit>();
  for (const embedding of embeddings) {
    if (!embedding) continue;
    for (const h of await searchChunks(params.companyId, embedding, 5)) {
      const prev = found.get(h.chunkId);
      if (!prev || prev.score < h.score) found.set(h.chunkId, h);
    }
  }
  const hits = [...found.values()].sort((a, b) => b.score - a.score).slice(0, texts.length > 2 ? 7 : 5);
  const relevant = hits.filter((h) => h.score >= MIN_RELEVANCE);
  const topScore = relevant[0]?.score ?? 0;

  const stock = catalog && match && match.mode !== 'none' && params.catalog
    ? [catalogBlock(catalog, match, params.catalog), storesLine(catalog)].filter(Boolean).join('\n\n')
    : '';

  // Спрашивает про свой заказ — отвечаем по данным склада, без менеджера.
  const ordersCtx = params.orders?.trim() && u?.intent !== 'buy' && ORDER_STATUS_Q.test(`${params.question}\n${query}`)
    ? params.orders.trim() : '';

  // Хочет купить, а базе нечего сказать — уточняем модель, размер, город.
  if (order && !managerOnly && relevant.length === 0 && !stock && !ordersCtx) return orderResult({ input: 0, output: 0, embed: embedTokens });

  // Ни базы, ни склада — до модели даже не идём: дешевле и честнее.
  if (relevant.length === 0 && !stock && !ordersCtx) {
    return {
      answer: '',
      confidence: 0,
      modelConfidence: 0,
      topScore,
      needsHuman: true,
      hits,
      usage: { inputTokens, outputTokens, embedTokens },
      ai: choice,
      understanding: u,
      catalog: catalogInfo,
      managerOnly,
    };
  }

  // Склад — первым и главнее базы знаний: в базе может быть общее «смотрите
  // каталог», а клиент спрашивает про конкретную модель, которая есть в блоке.
  const context = [
    ordersCtx
      ? `${ordersCtx}\n\nНа вопросы клиента о его заказе (статус, отправка, трек) отвечай только по блоку ЗАКАЗЫ. Сроков доставки, которых там нет, не обещай. Есть трек — дай его и ссылку для отслеживания.`
      : '',
    stock
      ? `${stock}\n\nНаличие, размеры и цены бери только из блока КАТАЛОГ — это данные склада на сейчас, они важнее базы знаний. Называя модель, добавь её ссылку из каталога. Точное количество пар не называй.`
      : '',
    relevant.length
      ? `Фрагменты базы знаний:\n\n${relevant.map((h, i) => `[${i + 1}] Источник: ${h.documentTitle}\n${h.content}`).join('\n\n---\n\n')}`
      : '',
  ].filter(Boolean).join('\n\n===\n\n');

  const result = await ai.generate({
    system: buildSystemPrompt(params.config, params.company),
    messages: normalizeHistory([
      ...history,
      {
        role: 'user',
        content: `${context}\n\n---\n\n${dialogNote(history, params.question, clientLang(params.question.split('\n').at(-1) ?? params.question, u?.lang))}Вопрос клиента: ${params.question}${query !== params.question ? `\n(Смысл вопроса: ${query})` : ''}${
          managerOnly ? '\n(Это вопрос о возврате, обмене или браке: коротко ответь по базе знаний и скажи, что менеджер сейчас подключится. Не обещай, что возврат или обмен одобрят. Нет условий в базе — needs_human = true.)' : ''
        }${
          order ? `\n(Клиент хочет купить. Если в базе есть ответ на это — ответь по нему; в конце спроси, чего не хватает для заказа: ${order.missing.map((f) => ({ model: 'модель', size: 'размер', city: 'город или самовывоз' })[f]).join(', ')}.)` : ''
        }`,
      },
    ]),
  });

  const parsed = parseAnswer(result.text);

  // Модель склонна завышать уверенность в себе, поэтому итог ограничиваем
  // качеством найденных фрагментов: нет опоры в базе — нет высокой оценки.
  // Ответ по данным склада опирается на каталог, а не на базу знаний.
  const confidence = stock || ordersCtx ? parsed.confidence : Math.min(parsed.confidence, Math.round(topScore * 100));

  const photos = match?.mode === 'pick' && params.catalog?.photoUrl
    ? match.items.slice(0, 3).map((i) => ({
        url: photoLink(params.catalog!, i.id),
        caption: `${i.name} — ${new Intl.NumberFormat('ru-RU').format(i.price).replace(/[\u00a0\u202f]/g, ' ')} ₸${productLink(params.catalog!, i.id) ? `\n${productLink(params.catalog!, i.id)}` : ''}`,
      })).filter((p) => p.url)
    : [];

  const needsHuman = parsed.needsHuman || confidence < params.config.confidenceThreshold;
  // База не помогла — для покупателя лучше уточнить заказ, чем звать менеджера.
  if (order && !managerOnly && (needsHuman || !parsed.answer)) return orderResult({ input: result.inputTokens, output: result.outputTokens, embed: embedTokens });

  return {
    answer: parsed.answer,
    confidence,
    modelConfidence: parsed.confidence,
    topScore,
    needsHuman,
    hits,
    usage: { inputTokens: inputTokens + result.inputTokens, outputTokens: outputTokens + result.outputTokens, embedTokens },
    ai: choice,
    understanding: u,
    catalog: catalogInfo,
    photos,
    managerOnly,
  };
}

/**
 * Подсказка модели о ходе диалога. Без неё каждый ответ звучит как первый:
 * снова «Здравствуйте, я виртуальный консультант…», снова ссылка на каталог
 * и «напишите имя и город» — клиент получает одно и то же по кругу.
 */
export function dialogNote(history: ChatMessage[], question: string, lang?: 'ru' | 'kk') {
  const notes: string[] = [];
  // Инструкция владельца часто написана по-русски, и модель отвечает
  // по-русски даже на казахский вопрос. Язык клиента — явно.
  if (lang === 'kk') notes.push('Клиент пишет по-казахски — ответь по-казахски.');
  else if (lang === 'ru') notes.push('Клиент пишет по-русски — ответь по-русски.');
  if (history.some((m) => m.role === 'assistant')) {
    notes.push('Ты уже отвечал этому клиенту: не здоровайся и не представляйся снова, не повторяй ссылки, условия и просьбы, которые уже были в твоих сообщениях выше.');
  }
  if (question.split('\n').filter((l) => l.trim()).length > 1) {
    notes.push('Клиент прислал несколько сообщений подряд — ответь на все его вопросы одним коротким сообщением.');
  }
  return notes.length ? `(${notes.join(' ')})\n\n` : '';
}

/**
 * Заказ для менеджера из того, что клиент уже сказал. Без модели, размера
 * (если есть склад с размерами) и города или способа получения менеджеру
 * пришлось бы переспрашивать — этого не хватает в missing.
 */
export function draftOrder(u: Understanding, catalog: Catalog | null, match: CatalogMatch | null, source: CatalogSource | null): OrderDraft {
  const item = match?.mode === 'product' && match.items.length === 1 ? match.items[0]! : null;
  const size = u.size ? u.size.replace(',', '.').match(/\d{1,2}(?:\.5)?/)?.[0] ?? u.size : '';
  const modelText = item ? `${item.name}${item.article ? ` (арт. ${item.article})` : ''}` : u.article ? `арт. ${u.article}${u.model ? `, ${u.model}` : ''}` : u.model;

  const missing: OrderField[] = [];
  if (!modelText) missing.push('model');
  const sized = item ? item.sizes.length > 0 : !!catalog;
  if (sized && !size) missing.push('size');
  if (!u.city && !u.delivery) missing.push('city');

  const product = [modelText, size ? `размер ${size}` : ''].filter(Boolean).join(', ');
  const comment = [u.city, u.delivery, u.payment].filter(Boolean).join(' · ');
  const lines = [
    `Модель: ${modelText || 'не назвал'}${size ? `, размер ${size}` : ''}${item ? ` — ${new Intl.NumberFormat('ru-RU').format(item.price).replace(/[\u00a0\u202f]/g, ' ')} ₸` : ''}`,
    u.city ? `Город: ${u.city}` : '',
    u.delivery ? `Получение: ${u.delivery}` : '',
    u.payment ? `Оплата: ${u.payment}` : '',
  ];
  if (item && size && catalog) {
    const { here, order } = sizeAvailability(catalog, item, size);
    lines.push(here.length ? `Наличие ${size}: ${here.join('; ')}` : order.length ? `Наличие ${size}: только на складе, под заказ` : `Наличие ${size}: нет ни в одном магазине`);
  }
  if (item && source) {
    const link = productLink(source, item.id);
    if (link) lines.push(link);
  }
  return {
    missing,
    lang: u.lang,
    summary: lines.filter(Boolean).join('\n'),
    product,
    amount: item?.price ?? null,
    comment,
  };
}

const ASK: Record<'ru' | 'kk', Record<OrderField, string>> = {
  ru: { model: 'какую модель берёте (артикул или ссылку из каталога)', size: 'какой размер', city: 'в какой город доставить или заберёте в магазине' },
  kk: { model: 'қай модельді аласыз (артикул немесе каталогтағы сілтеме)', size: 'қай размер', city: 'қай қалаға жеткізу керек, әлде дүкеннен аласыз ба' },
};

/** «Хорошо! Подскажите, пожалуйста: какой размер и в какой город доставить…» */
export function orderQuestion(order: Pick<OrderDraft, 'missing' | 'lang'>) {
  const parts = order.missing.map((f) => ASK[order.lang][f]);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${order.lang === 'kk' ? 'және' : 'и'} ${parts.at(-1)}` : parts[0] ?? '';
  return order.lang === 'kk' ? `Жақсы! Нақтылап жіберіңізші: ${list}?` : `Хорошо! Подскажите, пожалуйста, ${list}?`;
}

/** Клиенту перед передачей менеджеру. */
export function orderConfirmation(lang: 'ru' | 'kk') {
  return lang === 'kk'
    ? 'Керемет, тапсырысыңызды менеджерге беремін — ол бар-жоғын растап, төлем деректерін жібереді.'
    : 'Отлично, передаю заказ менеджеру — он подтвердит наличие и пришлёт данные для оплаты.';
}

/**
 * Провайдеры капризны к форме истории: Anthropic требует, чтобы диалог
 * начинался с user и роли чередовались. В переписке так бывает не всегда
 * (ассистент написал первым, клиент прислал три сообщения подряд), поэтому
 * ведущие ответы ассистента отбрасываем, а подряд идущие реплики одной
 * стороны склеиваем.
 */
export function normalizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const content = m.content.trim().slice(0, 4000);
    if (!content) continue;
    if (out.length === 0 && m.role !== 'user') continue;
    const prev = out.at(-1);
    if (prev && prev.role === m.role) prev.content += `\n${content}`;
    else out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return out;
}

function parseAnswer(raw: string): { answer: string; confidence: number; needsHuman: boolean } {
  let cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  // Модель иногда добавляет фразу до или после JSON — берём сам объект.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);

  try {
    const data = JSON.parse(cleaned) as { answer?: string; confidence?: number; needs_human?: boolean };
    return {
      answer: (data.answer ?? '').trim(),
      confidence: Math.max(0, Math.min(100, Number(data.confidence ?? 0))),
      needsHuman: Boolean(data.needs_human),
    };
  } catch {
    // Модель ответила не JSON — считаем это сбоем и зовём человека,
    // а не отправляем клиенту сырой текст неизвестного качества.
    return { answer: '', confidence: 0, needsHuman: true };
  }
}

/** Ответ не покупателю: спасибо, передадим руководству. */
export function partnerReply(lang: 'ru' | 'kk') {
  return lang === 'kk'
    ? 'Сәлеметсіз бе! Ұсынысыңызға рахмет — басшылыққа жеткіземін, сізбен байланысады.'
    : 'Здравствуйте! Спасибо за предложение — передам его руководству, с вами свяжутся.';
}
