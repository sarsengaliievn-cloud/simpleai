import { prisma } from './client.js';

/**
 * Одноразовый переход локальной базы на миграции.
 *
 * До миграций схема создавалась `prisma migrate dev` без сохранённых файлов
 * плюс ручным vector.sql. Таблицы и данные остаются как есть — убираем только
 * то, чего нет в schema.prisma (индексы из vector.sql) и старую историю
 * миграций, файлов которой больше нет. Дальше скрипт `baseline` помечает
 * 0_init как уже применённую.
 *
 * Безопасно запускать повторно.
 */
async function main() {
  const statements = [
    // Колонка уже есть у тех, кто запускал vector.sql; у остальных появится.
    `ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536)`,
    // ivfflat с фильтром по компании может терять результаты — см. 0_init.
    `DROP INDEX IF EXISTS knowledge_chunks_embedding_idx`,
    // Дубль индекса из схемы (companyId, documentId).
    `DROP INDEX IF EXISTS knowledge_chunks_company_idx`,
    // История от удалённых файлов миграций мешает migrate dev.
    `DROP TABLE IF EXISTS _prisma_migrations`,
  ];

  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
    console.log('✓', sql);
  }
  console.log('\nГотово. Сейчас Prisma пометит миграцию 0_init как применённую.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
