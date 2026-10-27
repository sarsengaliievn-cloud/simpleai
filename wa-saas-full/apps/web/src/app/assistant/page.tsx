import { aiLabel, resolveAI, MODELS, providerAvailable, billingSettings, costUsd, chargeTiyn, formatTiyn } from '@wa/core';
import { ModelPicker, type ModelOption } from '@/components/ModelPicker';
import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { isSuperAdmin } from '@/lib/admin';
import { buildSystemPrompt } from '@wa/core';
import { saveAssistant } from './actions';

export const dynamic = 'force-dynamic';

const TONES = ['Дружелюбный', 'Профессиональный', 'Короткий', 'Подробный', 'Формальный'];
const LANGS: Array<[string, string]> = [['ru', 'Русский'], ['kk', 'Қазақша'], ['en', 'English']];
const DAYS: Array<[number, string]> = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [7, 'Вс']];

type Props = { searchParams: Promise<{ saved?: string }> };

export default async function AssistantPage({ searchParams }: Props) {
  const { saved } = await searchParams;
  const { company, db, user, role } = await requireCompany('ai:manage');

  const config = (await db.aIConfiguration.findFirst()) ?? {
    enabled: false, model: 'claude-sonnet-4-6', role: `Консультант компании «${company.name}»`,
    goals: ['отвечать на вопросы о наличии, размерах и цене', 'рассказывать про доставку', 'собирать заявки на заказ'],
    tone: 'Дружелюбный', languages: ['ru', 'kk'], forbidden: 'Давать скидки. Обещать сроки, которых нет в базе знаний. Выдумывать наличие товара.',
    extraRules: '', confidenceThreshold: 70, advancedMode: false, advancedPrompt: '',
    replyDelaySec: 8, splitReplies: true, splitMaxChars: 350,
    workingHoursEnabled: false, workingDays: [1, 2, 3, 4, 5, 6, 7], workStart: '09:00', workEnd: '21:00',
    offHoursMessage: '', transcribeVoice: true,
  };

  const preview = buildSystemPrompt(config, company);
  const choice = resolveAI('aiProvider' in config ? config : null);
  const ai = aiLabel(choice);

  // Примерная цена ответа: инструкция и найденные фрагменты ~2500 токенов, ответ ~250.
  const settings = await billingSettings();
  const options: ModelOption[] = MODELS.map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label,
    note: m.note,
    available: providerAvailable(m.provider),
    price: `≈ ${formatTiyn(chargeTiyn(costUsd({ provider: m.provider, model: m.id, inputTokens: 2500, outputTokens: 250, embedTokens: 40 }, settings), settings))} за ответ`,
  }));

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} role={role} balance={{ tiyn: company.balanceTiyn, lastTopup: company.lastTopupTiyn }} superAdmin={isSuperAdmin(user.email)} />
      <div className="main">
        <header className="top">
          <div className="top-t"><h1>Как отвечает ассистент</h1><p className="top-hint">Как бот разговаривает с клиентами: тон, правила, рабочие часы</p></div>
          <span className="chip" style={{ marginLeft: 'auto', flex: 'none' }} title={`Модель: ${ai.model}`}>
            {ai.provider} · {ai.model}
          </span>
          <span className={`chip ${config.enabled ? 'chip-ok' : ''}`} style={{ flex: 'none' }}>
            <span className="dot" />{config.enabled ? 'Отвечает клиентам' : 'Выключен'}
          </span>
        </header>

        <div className="page page-narrow">
          {saved && (
            <div className="chip chip-ok" style={{ height: 'auto', padding: '9px 12px', marginBottom: 16, display: 'block' }}>
              Настройки сохранены — ассистент уже работает по ним.
            </div>
          )}
          <ModelPicker options={options} current={{ provider: choice.provider, model: choice.model }} />

          <form action={saveAssistant}>
            <div className="card card-p" style={{ marginBottom: 16 }}>
              <label className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <span style={{ fontWeight: 700 }}>Отвечать автоматически</span>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    Выключенный ассистент ничего не отправляет — все сообщения ждут менеджера.
                  </p>
                </span>
                <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
              </label>
            </div>

            <div className="card card-p" style={{ marginBottom: 16 }}>
              <label className="field">
                <span className="label">Роль</span>
                <input className="input" name="role" defaultValue={config.role} />
              </label>

              <label className="field">
                <span className="label">Задачи — по одной в строке</span>
                <textarea className="textarea" name="goals" defaultValue={config.goals.join('\n')} />
              </label>

              <label className="field">
                <span className="label">Стиль</span>
                <select className="select" name="tone" defaultValue={config.tone}>
                  {TONES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>

              <div className="field">
                <span className="label">Языки</span>
                <div className="row" style={{ gap: 14 }}>
                  {LANGS.map(([code, label]) => (
                    <label className="row small" key={code} style={{ gap: 6 }}>
                      <input type="checkbox" name="languages" value={code} defaultChecked={config.languages.includes(code)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <label className="field">
                <span className="label">Запрещено</span>
                <textarea className="textarea" name="forbidden" defaultValue={config.forbidden} />
              </label>

              <label className="field">
                <span className="label">Дополнительные правила</span>
                <textarea className="textarea" name="extraRules" defaultValue={config.extraRules}
                          placeholder="Например: предлагай оформить заказ, если клиент спросил про размер и цену" />
              </label>

              <label className="field" style={{ marginBottom: 0 }}>
                <span className="label">Порог уверенности, %</span>
                <input className="input" type="number" name="threshold" min={0} max={100} defaultValue={config.confidenceThreshold} />
                <span className="hint">
                  Ниже порога ассистент не отвечает, а передаёт диалог менеджеру. 70% — разумная середина:
                  выше 85% он начнёт звать человека почти всегда.
                </span>
              </label>
            </div>

            <div className="card card-p" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700 }}>Автоматизация</div>
              <p className="small muted" style={{ marginTop: 4, marginBottom: 16 }}>
                Чтобы ассистент вёл себя как живой менеджер, а не как бот.
              </p>

              <label className="field">
                <span className="label">Ждать, пока клиент допишет, сек</span>
                <input className="input" type="number" name="replyDelaySec" min={0} max={60}
                       defaultValue={config.replyDelaySec} style={{ maxWidth: 140 }} />
                <span className="hint">
                  Клиенты пишут по частям: «Здравствуйте» → «есть 42?» → «чёрные». Ассистент ждёт
                  столько секунд после последнего сообщения и отвечает на всё сразу. 0 — отвечать мгновенно.
                </span>
              </label>

              <div className="field">
                <label className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label" style={{ margin: 0 }}>Длинный ответ — несколькими сообщениями</span>
                  <input type="checkbox" name="splitReplies" defaultChecked={config.splitReplies} />
                </label>
                <div className="row small" style={{ marginTop: 8, gap: 8 }}>
                  <span className="muted">Не длиннее</span>
                  <input className="input" type="number" name="splitMaxChars" min={120} max={1000}
                         defaultValue={config.splitMaxChars} style={{ maxWidth: 110 }} />
                  <span className="muted">символов в одном сообщении</span>
                </div>
                <span className="hint">Части уходят с паузой в 1–4 секунды, как будто их набирают.</span>
              </div>

              <div className="field">
                <label className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label" style={{ margin: 0 }}>Расшифровывать голосовые</span>
                  <input type="checkbox" name="transcribeVoice" defaultChecked={config.transcribeVoice} />
                </label>
                <span className="hint">
                  Ассистент слушает голосовое (русский и казахский), отвечает на него как на текст,
                  а расшифровка видна в диалоге. Выключено — голосовые сразу уходят менеджеру.
                </span>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label" style={{ margin: 0 }}>Рабочие часы ассистента</span>
                  <input type="checkbox" name="workingHoursEnabled" defaultChecked={config.workingHoursEnabled} />
                </label>
                <div className="row small" style={{ marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
                  {DAYS.map(([day, label]) => (
                    <label className="row" key={day} style={{ gap: 5 }}>
                      <input type="checkbox" name="workingDays" value={day}
                             defaultChecked={config.workingDays.includes(day)} />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="row small" style={{ marginTop: 10, gap: 8 }}>
                  <span className="muted">с</span>
                  <input className="input" type="time" name="workStart" defaultValue={config.workStart} style={{ maxWidth: 130 }} />
                  <span className="muted">до</span>
                  <input className="input" type="time" name="workEnd" defaultValue={config.workEnd} style={{ maxWidth: 130 }} />
                </div>
                <span className="hint">
                  Время по часовому поясу компании ({company.timezone}). Начало позже конца — ночная смена:
                  например, 21:00–09:00, чтобы ассистент закрывал ночь, а днём писали менеджеры.
                  Вне графика ассистент молчит, сообщения ждут менеджера.
                </span>
                <textarea className="textarea" name="offHoursMessage" style={{ marginTop: 10, minHeight: 70 }}
                          defaultValue={config.offHoursMessage}
                          placeholder="Сообщение вне графика (необязательно). Например: Спасибо! Мы работаем с 9:00 до 21:00 — ответим утром." />
                <span className="hint">Уходит клиенту один раз, не чаще раза в 12 часов. Пусто — ассистент просто молчит.</span>
              </div>
            </div>

            <div className="card card-p" style={{ marginBottom: 16 }}>
              <label className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontWeight: 700 }}>Писать инструкцию вручную</span>
                <input type="checkbox" name="advancedMode" defaultChecked={config.advancedMode} />
              </label>
              <textarea className="textarea mono" name="advancedPrompt" style={{ minHeight: 120, fontSize: 13 }}
                        defaultValue={config.advancedPrompt} placeholder="Полная системная инструкция" />
              <p className="hint">
                Запрет на выдумывание дописывается в любом случае — отключить его нельзя.
              </p>
            </div>

            <button className="btn btn-primary" type="submit">Сохранить</button>
          </form>

          <div className="card card-p" style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Что уходит модели сейчас</div>
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)', lineHeight: 1.6 }}>{preview}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
