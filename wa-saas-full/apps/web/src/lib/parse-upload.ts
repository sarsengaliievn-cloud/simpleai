/**
 * Извлечение текста из загруженного файла. PDF, DOCX и XLSX разбираются
 * библиотеками, которые ставятся отдельно, поэтому импорт ленивый:
 * без них TXT, CSV и Markdown продолжают работать.
 */
export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
    return buffer.toString('utf8');
  }

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return wb.SheetNames
      .map((sheet) => `# ${sheet}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheet]!)}`)
      .join('\n\n');
  }

  if (name.endsWith('.pdf')) {
    const pdfParse = (await import('pdf-parse')).default;
    const { text } = await pdfParse(buffer);
    return text;
  }

  throw new Error('Формат не поддерживается. Загрузите PDF, DOCX, XLSX, TXT, CSV или MD.');
}
