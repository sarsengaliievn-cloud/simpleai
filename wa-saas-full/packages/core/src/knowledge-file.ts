/**
 * База знаний одним файлом: скачать, поправить в Блокноте или Word и
 * загрузить обратно. Документы в файле разделены строками-заголовками —
 * по ним при обратной загрузке понятно, какой документ заменить.
 */

/**
 * Текст документа из фрагментов. Соседние фрагменты перекрываются (хвост
 * предыдущего повторяется в начале следующего) — повтор убираем.
 * Нужно для документов, загруженных до того, как исходный текст стали хранить.
 */
export function joinChunks(chunks: string[]): string {
  let out = '';
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!out) { out = chunk; continue; }
    let cut = 0;
    for (let n = Math.min(160, chunk.length, out.length); n >= 12; n -= 1) {
      if (out.endsWith(chunk.slice(0, n))) { cut = n; break; }
    }
    // Перекрытие режется по символам, иногда посреди слова — ищем и с
    // обрезанным началом фрагмента.
    if (!cut) {
      for (let skip = 1; skip <= 20 && !cut; skip += 1) {
        for (let n = Math.min(160, chunk.length - skip, out.length); n >= 12; n -= 1) {
          if (out.endsWith(chunk.slice(skip, skip + n))) { cut = skip + n; break; }
        }
      }
    }
    const rest = chunk.slice(cut).replace(/^\s+/, '');
    if (rest) out += (cut ? (/^\n/.test(chunk.slice(cut)) ? '\n\n' : ' ') : '\n\n') + rest;
  }
  return out.trim();
}

const MARK = /^[ \t]*={3,}[ \t]*ДОКУМЕНТ:[ \t]*(.+?)[ \t]*={3,}[ \t]*$/gm;
const ID_TAG = /\s*\[#([0-9a-f]{8})\]\s*$/i;

export function knowledgeMark(title: string, id: string) {
  return `===== ДОКУМЕНТ: ${title.replace(/=+/g, '').trim()} [#${id.slice(0, 8)}] =====`;
}

/** Вся база одним текстом. */
export function knowledgeExport(company: string, docs: Array<{ id: string; title: string; text: string }>, at = new Date()) {
  const head = [
    `База знаний «${company}» · выгружено ${at.toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })}`,
    '',
    'Как править: меняйте текст под заголовком и загрузите файл обратно в «Базу знаний».',
    'Строки «===== ДОКУМЕНТ: … =====» не трогайте — по ним понятно, какой документ заменить.',
    'Новый документ — добавьте такую же строку со своим названием (без [#…]) и текст под ней.',
    'Удалённый из файла документ в базе остаётся — удалить его можно кнопкой в списке.',
  ].join('\n');
  return [head, ...docs.map((d) => `${knowledgeMark(d.title, d.id)}\n\n${d.text.trim()}`)].join('\n\n\n') + '\n';
}

export type KnowledgeSection = { title: string; idPrefix: string | null; text: string };

/**
 * Разбор файла базы. null — в файле нет заголовков документов, значит это
 * обычный документ, а не выгрузка базы.
 */
export function parseKnowledgeFile(text: string): KnowledgeSection[] | null {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const marks = [...clean.matchAll(MARK)];
  if (!marks.length) return null;
  return marks.map((m, i) => {
    const raw = m[1]!.trim();
    const tag = raw.match(ID_TAG);
    const body = clean.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1]!.index : clean.length);
    return { title: raw.replace(ID_TAG, '').trim().slice(0, 200) || 'Документ', idPrefix: tag ? tag[1]!.toLowerCase() : null, text: body.trim() };
  });
}

/** Сравнение без мелочей: лишние пробелы и переводы строк — не правка. */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
