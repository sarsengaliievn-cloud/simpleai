'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma, DEFAULT_STAGES } from '@wa/db';
import { hashPassword, createSession } from '@/lib/auth';

function slugify(name: string) {
  const base = name.toLowerCase().trim()
    .replace(/[^a-zа-яёәіңғүұқөһ0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'company'}-${Math.random().toString(36).slice(2, 7)}`;
}

export type RegisterValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
};
export type RegisterState = { error?: string; values?: RegisterValues } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function register(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const values: RegisterValues = {
    firstName: String(formData.get('firstName') ?? '').trim().slice(0, 80),
    lastName: String(formData.get('lastName') ?? '').trim().slice(0, 80),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    phone: String(formData.get('phone') ?? '').trim().slice(0, 30),
    company: String(formData.get('company') ?? '').trim().slice(0, 120),
  };
  const password = String(formData.get('password') ?? '');

  // Введённое возвращаем в форму — React 19 очищает её после отправки.
  const fail = (error: string): RegisterState => ({ error, values });

  if (!values.firstName || !values.lastName || !values.email || !values.company) {
    return fail('Заполните все поля');
  }
  if (!EMAIL_RE.test(values.email) || values.email.length > 200) {
    return fail('Проверьте адрес почты');
  }
  if (password.length < 8) {
    return fail('Пароль должен быть не короче 8 символов');
  }
  if (password.length > 200) {
    return fail('Слишком длинный пароль');
  }

  const existing = await prisma.user.findUnique({ where: { email: values.email } });
  if (existing) {
    return fail('Пользователь с такой почтой уже зарегистрирован');
  }

  const passwordHash = await hashPassword(password);

  // Пользователь, компания, членство и настройки ассистента создаются
  // одной транзакцией: половинчатая регистрация хуже, чем никакой.
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: values.email,
          firstName: values.firstName,
          lastName: values.lastName,
          phone: values.phone || null,
          passwordHash,
        },
      });

      const company = await tx.company.create({
        data: { name: values.company, slug: slugify(values.company) },
      });

      await tx.membership.create({
        data: { userId: created.id, companyId: company.id, role: 'OWNER' },
      });

      await tx.aIConfiguration.create({
        data: {
          companyId: company.id,
          role: `Консультант компании «${values.company}»`,
          goals: ['отвечать на вопросы клиентов', 'рассказывать про доставку и оплату'],
          languages: ['ru', 'kk'],
          forbidden: 'Выдумывать наличие товара, цены и сроки. Давать скидки.',
        },
      });

      // Воронка CRM с этапами по умолчанию — их можно переименовать.
      await tx.pipelineStage.createMany({
        data: DEFAULT_STAGES.map((s) => ({ ...s, companyId: company.id })),
      });

      await tx.auditLog.create({
        data: { companyId: company.id, actorUserId: created.id, action: 'company.created' },
      });

      return created.id;
    });
  } catch (error) {
    // Две одновременные регистрации на одну почту: проверку выше прошли
    // обе, уникальный индекс пропустил только первую.
    if ((error as { code?: string }).code === 'P2002') {
      return fail('Пользователь с такой почтой уже зарегистрирован');
    }
    console.error('[register] сбой', error);
    return fail('Не удалось создать аккаунт. Попробуйте ещё раз.');
  }

  const h = await headers();
  await createSession(userId, {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: h.get('user-agent')?.slice(0, 300) ?? undefined,
  });
  redirect('/conversations');
}
