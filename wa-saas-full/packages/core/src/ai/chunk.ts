const TARGET = 800;
const OVERLAP = 120;

/**
 * Режем по абзацам, а не по символам: разорванный посреди предложения кусок
 * даёт мусорный эмбеддинг и всплывает в поиске не по делу.
 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > TARGET) {
      if (current) { chunks.push(current.trim()); current = ''; }
      for (const sentence of paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph]) {
        // Текст без знаков препинания (выгрузка таблицы, сплошной блок)
        // иначе уехал бы одним куском на несколько тысяч символов.
        for (const piece of hardSplit(sentence)) {
          if ((current + piece).length > TARGET && current) { chunks.push(current.trim()); current = ''; }
          current += piece;
        }
      }
      continue;
    }

    if ((current + '\n\n' + paragraph).length > TARGET && current) {
      chunks.push(current.trim());
      current = current.slice(-OVERLAP);
    }
    current += (current ? '\n\n' : '') + paragraph;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 20);
}

function hardSplit(text: string): string[] {
  if (text.length <= TARGET) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += TARGET) out.push(text.slice(i, i + TARGET));
  return out;
}

/** Грубая оценка: для кириллицы примерно 2,5 символа на токен. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 2.5);
