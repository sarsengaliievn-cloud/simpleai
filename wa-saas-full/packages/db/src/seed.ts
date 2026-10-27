import { randomBytes, scryptSync } from 'node:crypto';
import { prisma } from './client.js';
import { DEFAULT_STAGES } from './crm.js';

/** Тот же формат, что и в приложении: salt:hash, scrypt. */
function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

/**
 * Demo Store из ТЗ: компания, номер WhatsApp, клиенты и переписка.
 * Данные для разработки — в прод не попадают.
 */
const HOUR = 60 * 60 * 1000;
const ago = (h: number) => new Date(Date.now() - h * HOUR);

async function main() {
  const company = await prisma.company.upsert({
    where: { slug: 'demo-store' },
    update: {},
    create: {
      name: 'Demo Store',
      slug: 'demo-store',
      industry: 'Розничная торговля',
      country: 'Казахстан',
      city: 'Алматы',
      description: 'Оригинальные кроссовки и кеды. Три магазина в Алматы, доставка по Казахстану.',
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'demo@demostore.kz' },
    update: {},
    create: {
      email: 'demo@demostore.kz',
      firstName: 'Демо',
      lastName: 'Владелец',
      passwordHash: hashPassword('demo12345'),
      emailVerified: new Date(),
    },
  });

  await prisma.membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
    update: {},
    create: { userId: user.id, companyId: company.id, role: 'OWNER' },
  });

  await prisma.aIConfiguration.upsert({
    where: { companyId: company.id },
    update: {},
    create: {
      companyId: company.id,
      role: 'Консультант магазина «Demo Store»',
      goals: ['отвечать о наличии, размерах и цене', 'рассказывать про доставку'],
      forbidden: 'Выдумывать наличие товара, цены и сроки. Давать скидки.',
    },
  });

  // Этапы воронки CRM.
  if ((await prisma.pipelineStage.count({ where: { companyId: company.id } })) === 0) {
    await prisma.pipelineStage.createMany({
      data: DEFAULT_STAGES.map((s) => ({ ...s, companyId: company.id })),
    });
  }
  const newStage = await prisma.pipelineStage.findFirstOrThrow({ where: { companyId: company.id, kind: 'NEW' } });

  const account = await prisma.whatsAppAccount.upsert({
    where: { companyId_wabaId: { companyId: company.id, wabaId: '104857392018477' } },
    update: {},
    create: {
      companyId: company.id,
      wabaId: '104857392018477',
      businessName: 'Demo Store',
      accessToken: 'seed-placeholder-not-a-real-token',
      connectedVia: 'MANUAL',
      status: 'CONNECTED',
    },
  });

  const number = await prisma.whatsAppPhoneNumber.upsert({
    where: { phoneNumberId: 'TEST_NUMBER_ID' },
    update: {},
    create: {
      companyId: company.id,
      accountId: account.id,
      phoneNumberId: 'TEST_NUMBER_ID',
      displayPhoneNumber: '+7 707 512 44 90',
      verifiedName: 'Demo Store',
      qualityRating: 'GREEN',
      messagingLimit: '1K',
      status: 'CONNECTED',
      webhookVerifiedAt: new Date(),
    },
  });

  const people = [
    {
      waId: '77012345678', name: 'Айгерим Смагулова', city: 'Алматы', mode: 'AI' as const, hours: 0.2,
      msgs: [
        ['IN', 'CUSTOMER', 'Здравствуйте! Кроссовки Nike Air Max 42 размер есть?', 1.2],
        ['OUT', 'AI', 'Здравствуйте, Айгерим! Да, Nike Air Max 90 в 42 размере есть — 3 пары, 47 900 ₸. Оформить доставку?', 1.1],
        ['IN', 'CUSTOMER', 'А есть такие же, но чёрные?', 0.2],
      ],
    },
    {
      waId: '77758812043', name: 'Данияр Ким', city: 'Астана', mode: 'HUMAN' as const, hours: 0.6,
      msgs: [
        ['IN', 'CUSTOMER', 'Здравствуйте, доставка в Астану сколько идёт?', 2],
        ['OUT', 'AI', 'Здравствуйте! Доставка в Астану — 2–3 рабочих дня, 2 500 ₸. При заказе от 50 000 ₸ бесплатно.', 1.9],
        ['IN', 'CUSTOMER', 'А если брак? Хочу поговорить с менеджером', 0.7],
        ['OUT', 'SYSTEM', 'Ассистент передал диалог менеджеру: клиент запросил человека', 0.6],
      ],
    },
    {
      waId: '77074459012', name: 'Мадина Оспанова', city: 'Шымкент', mode: 'AI' as const, hours: 1.5,
      msgs: [
        ['IN', 'CUSTOMER', 'Сәлеметсіз бе, дүкен қай жерде орналасқан?', 1.6],
        ['OUT', 'AI', 'Сәлеметсіз бе! Дүкеніміз Алматы қаласында, Абай даңғылы 115. Жұмыс уақыты: 10:00–21:00.', 1.5],
      ],
    },
  ];

  for (const p of people) {
    const customer = await prisma.customer.upsert({
      where: { companyId_waId: { companyId: company.id, waId: p.waId } },
      update: {},
      create: {
        companyId: company.id,
        waId: p.waId,
        phone: `+${p.waId}`,
        name: p.name,
        city: p.city,
        firstContactAt: ago(48),
        lastContactAt: ago(p.hours),
      },
    });

    const exists = await prisma.conversation.findFirst({ where: { customerId: customer.id } });
    if (exists) continue;

    const conversation = await prisma.conversation.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        phoneNumberId: number.id,
        mode: p.mode,
        lastMessageAt: ago(p.hours),
        // Окно считается от последнего входящего сообщения клиента.
        windowExpiresAt: new Date(ago(p.hours).getTime() + 24 * HOUR),
        unreadCount: p.mode === 'AI' ? 1 : 0,
      },
    });

    await prisma.deal.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        conversationId: conversation.id,
        stageId: newStage.id,
        createdAt: ago(48),
        stageChangedAt: ago(48),
      },
    });

    for (const [direction, author, text, hoursAgo] of p.msgs) {
      await prisma.message.create({
        data: {
          companyId: company.id,
          conversationId: conversation.id,
          direction: direction === 'IN' ? 'INBOUND' : 'OUTBOUND',
          authorType: author as 'CUSTOMER' | 'AI' | 'SYSTEM',
          type: 'TEXT',
          text: text as string,
          status: direction === 'IN' ? 'DELIVERED' : 'SENT',
          createdAt: ago(hoursAgo as number),
          sentAt: ago(hoursAgo as number),
        },
      });
    }
  }

  console.log(`Готово: ${company.name} (${company.id})`);
  console.log('Вход: demo@demostore.kz / demo12345');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
