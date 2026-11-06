import { describe, it, expect } from 'vitest';
import { parseTemplateText, templateName, renderTemplate, TemplateError } from './templates.js';

describe('шаблоны WhatsApp', () => {
  it('поля словами превращаются в {{1}}, {{2}}', () => {
    const t = parseTemplateText('Здравствуйте, {имя}! Ваш заказ отправлен. Трек-номер: {трек}. Отследить можно на сайте Казпочты.');
    expect(t.body).toBe('Здравствуйте, {{1}}! Ваш заказ отправлен. Трек-номер: {{2}}. Отследить можно на сайте Казпочты.');
    expect(t.variables).toEqual(['имя', 'трек']);
  });
  it('одно поле дважды — один номер', () => {
    expect(parseTemplateText('Привет, {Имя}! {имя}, ждём вас снова в магазине.').variables).toEqual(['имя']);
  });
  it('правила Meta: не в начале, не в конце, не подряд', () => {
    expect(() => parseTemplateText('{имя}, здравствуйте!')).toThrow(/начинаться/);
    expect(() => parseTemplateText('Ваш трек-номер: {трек}.')).toThrow(/заканчиваться/);
    expect(() => parseTemplateText('Здравствуйте, {имя} {трек} отправлен.')).toThrow(/подряд/);
    expect(() => parseTemplateText('Здравствуйте, {{1}}!')).toThrow(TemplateError);
    expect(() => parseTemplateText('')).toThrow(/текст/);
  });
  it('имя в Meta — латиница с хвостом', () => {
    expect(templateName('Трек-номер', 'ab12')).toBe('trek_nomer_ab12');
    expect(templateName('Қайта жазу', 'x1')).toBe('kayta_zhazu_x1');
  });
  it('текст для клиента', () => {
    expect(renderTemplate('Здравствуйте, {{1}}! Трек: {{2}}.', ['Айгерим', 'RB1KZ'])).toBe('Здравствуйте, Айгерим! Трек: RB1KZ.');
  });
});
