import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { buildSystemPrompt } from '@wa/core';
import { saveAssistant } from './actions';

export const dynamic = 'force-dynamic';

const TONES = ['Дружелюбный', 'Профессиональный', 'Короткий', 'Подробный', 'Формальный'];
const LANGS: Array<[string, string]> = [['ru', 'Русский'], ['kk', 'Қазақша'], ['en', 'English']];

type Props = { searchParams: Promise<{ saved?: string }> };

export default async function AssistantPage({ searchParams }: Props) {
  const { saved } = await searchParams;
  const { company, db, user } = await requireCompany();

  const config = (await db.aIConfiguration.findFirst()) ?? {
    enabled: false, model: 'claude-sonnet-4-6', role: `Консультант компании «${company.name}»`,
    goals: ['отвечать на вопросы о наличии, размерах и цене', 'рассказывать про доставку', 'собирать заявки на заказ'],
    tone: 'Дружелюбный', languages: ['ru', 'kk'], forbidden: 'Давать скидки. Обещать сроки, которых нет в базе знаний. Выдумывать наличие товара.',
    extraRules: '', confidenceThreshold: 70, advancedMode: false, advancedPrompt: '',
  };

  const preview = buildSystemPrompt(config, company);

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} />
      <div className="main">
        <header className="top">
          <h1>Ассистент</h1>
          <span className={`chip ${config.enabled ? 'chip-ok' : ''}`} style={{ marginLeft: 'auto' }}>
            <span className="dot" />{config.enabled ? 'Отвечает клиентам' : 'Выключен'}
          </span>
        </header>

        <div className="page page-narrow">
          {saved && (
            <div className="chip chip-ok" style={{ height: 'auto', padding: '9px 12px', marginBottom: 16, display: 'block' }}>
              Настройки сохранены — ассистент уже работает по ним.
            </div>
          )}
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
