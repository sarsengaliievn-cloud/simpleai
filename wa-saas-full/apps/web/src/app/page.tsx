import Link from 'next/link';

export const metadata = {
  title: 'SaudaBot — AI-ассистент для WhatsApp',
  description: 'Ассистент отвечает клиентам в WhatsApp: наличие, цена, доставка. Сложное передаёт менеджеру.',
};

const STEPS: Array<[string, string]> = [
  ['Клиент пишет в WhatsApp', 'Сообщение приходит на официальный номер компании через Meta Cloud API.'],
  ['Ассистент понимает вопрос', 'Наличие, цена, доставка, возврат, жалоба — определяется намерение.'],
  ['Поиск в базе знаний', 'Ответ собирается только из ваших документов и каталога, не из головы.'],
  ['Проверка уверенности', 'Ниже порога — диалог уходит менеджеру, а не превращается в выдумку.'],
  ['Ответ клиенту', 'Секунды вместо часов. Клиент и история сохраняются автоматически.'],
];

const FEATURES: Array<[string, string]> = [
  ['База знаний', 'Загрузите прайс, условия доставки и правила возврата. Ассистент отвечает по ним и ничего не придумывает.'],
  ['Общий инбокс', 'Вся переписка в одном окне. Менеджер забирает диалог у ассистента одной кнопкой.'],
  ['CRM без ручного ввода', 'Каждый написавший становится карточкой клиента с историей и количеством обращений.'],
  ['Аналитика', 'Сколько ассистент закрыл сам, где позвал человека, о чём чаще всего спрашивают.'],
  ['Проверка перед запуском', 'Тестовый чат: гоняете ассистента на своих вопросах, не трогая живых клиентов.'],
  ['Официальное подключение', 'Только WhatsApp Business Platform от Meta. Без серых схем и риска блокировки номера.'],
];

const PLANS: Array<[string, string, string[], boolean]> = [
  ['Старт', '19 900 ₸', ['1 номер WhatsApp', '1 000 ответов в месяц', 'До 50 документов', '2 сотрудника'], false],
  ['Рост', '49 900 ₸', ['2 номера WhatsApp', '5 000 ответов в месяц', 'Документы без ограничений', '10 сотрудников', 'Расширенная аналитика'], true],
  ['Бизнес', 'Договорная', ['Номера без ограничений', 'Индивидуальный лимит', 'API и вебхуки', 'Приоритетная поддержка'], false],
];

const FAQ: Array<[string, string]> = [
  ['Не заблокируют ли номер?', 'Подключение идёт через WhatsApp Business Platform — официальный путь Meta. Мы не используем веб-сессии и QR-обходы, из-за которых номера чаще всего и блокируют.'],
  ['Ассистент может выдумать ответ?', 'Он отвечает только из вашей базы знаний. Если данных нет или уверенность ниже порога, диалог уходит менеджеру. Порог настраиваете вы.'],
  ['На каких языках отвечает?', 'Русский, казахский и английский, с определением языка клиента. Один пишет на казахском, другой на русском — оба получат ответ на своём.'],
  ['Что если клиент хочет человека?', 'Достаточно попросить менеджера — ассистент сразу передаст диалог. Менеджер также может забрать любой диалог сам.'],
];

export default function LandingPage() {
  return (
    <>
      <header className="nav">
        <div className="pub nav-in">
          <span className="logo"><span className="logo-mark" />SaudaBot</span>
          <nav className="nav-links">
            <a href="#how">Как работает</a>
            <a href="#features">Возможности</a>
            <a href="#pricing">Тарифы</a>
            <a href="#faq">Вопросы</a>
          </nav>
          <Link href="/conversations" className="btn btn-primary btn-sm">Открыть панель</Link>
        </div>
      </header>

      <section className="hero">
        <div className="pub">
          <span className="eyebrow">WhatsApp Business Platform</span>
          <h1 className="display">AI, который отвечает вашим клиентам в WhatsApp 24/7</h1>
          <p className="lede">
            Подключите номер, загрузите информацию о бизнесе — и ассистент начнёт отвечать
            на вопросы о наличии, цене и доставке. Сложное передаст менеджеру.
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <Link href="/conversations" className="btn btn-primary btn-lg">Открыть панель</Link>
            <Link href="/playground" className="btn btn-ghost btn-lg">Попробовать ассистента</Link>
          </div>
        </div>
      </section>

      <section className="sec" id="how">
        <div className="pub">
          <div className="sec-head">
            <h2>Что происходит после сообщения клиента</h2>
            <p>Пять шагов, каждый из которых видно в панели — включая тот, где ассистент решает промолчать.</p>
          </div>
          <div className="rail">
            {STEPS.map(([title, text], i) => (
              <div className={`rail-item ${i < 3 ? 'on' : ''}`} key={title}>
                <h4 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h4>
                <p className="small muted" style={{ marginTop: 4 }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec" id="features">
        <div className="pub">
          <div className="sec-head">
            <h2>Что входит в платформу</h2>
            <p>Не отдельный чат-бот, а рабочее место отдела продаж вокруг WhatsApp.</p>
          </div>
          <div className="feat-grid">
            {FEATURES.map(([title, text]) => (
              <div className="feat" key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec" id="pricing">
        <div className="pub">
          <div className="sec-head">
            <h2>Тарифы</h2>
            <p>Первые 14 дней бесплатно. Оплата помесячно, без договора на год.</p>
          </div>
          <div className="price-grid">
            {PLANS.map(([name, amount, items, highlight]) => (
              <div className={`price ${highlight ? 'hl' : ''}`} key={name}>
                {highlight && <span className="chip chip-ok" style={{ marginBottom: 10 }}>Чаще всего выбирают</span>}
                <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
                <div className="price-amt">{amount}</div>
                <div className="tiny muted">{amount === 'Договорная' ? 'обсуждается индивидуально' : 'в месяц'}</div>
                <ul>
                  {items.map((item) => <li key={item}><span>{item}</span></li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec" id="faq">
        <div className="pub">
          <div className="sec-head"><h2>Вопросы</h2></div>
          <div style={{ maxWidth: 820 }}>
            {FAQ.map(([q, a]) => (
              <details className="faq-item" key={q}>
                <summary className="faq-q" style={{ cursor: 'pointer' }}>{q}</summary>
                <div className="faq-a">{a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="pub spread" style={{ flexWrap: 'wrap', gap: 16 }}>
          <span>© 2026 SaudaBot. Алматы, Казахстан</span>
        </div>
      </footer>
    </>
  );
}
