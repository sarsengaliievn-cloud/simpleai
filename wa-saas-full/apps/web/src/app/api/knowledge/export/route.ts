import { knowledgeExport } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { documentsWithText } from '@/lib/knowledge';

export const dynamic = 'force-dynamic';

/**
 * Скачать базу знаний (или один документ, ?id=…) текстом. Внутри — строки
 * «===== ДОКУМЕНТ: … =====»: поправленный файл загружается обратно и
 * обновляет те же документы.
 */
export async function GET(request: Request) {
  const { company, db } = await requireCompany('knowledge:manage');
  const id = new URL(request.url).searchParams.get('id');
  const docs = (await documentsWithText(db, id ? [id] : undefined)).filter((d) => d.text.trim());
  if (id && !docs.length) return new Response('Документ не найден', { status: 404 });

  const body = knowledgeExport(company.name, docs.map((d) => ({ id: d.id, title: d.title, text: d.text })));
  const date = new Date().toISOString().slice(0, 10);
  const base = id ? docs[0]!.title : `baza-znaniy_${date}`;
  const ascii = base.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'baza';
  // BOM — чтобы Блокнот и Word сразу открыли кириллицу правильно.
  return new Response(`﻿${body.replace(/\n/g, '\r\n')}`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ascii}.txt"; filename*=UTF-8''${encodeURIComponent(base)}.txt`,
      'Cache-Control': 'no-store',
    },
  });
}
