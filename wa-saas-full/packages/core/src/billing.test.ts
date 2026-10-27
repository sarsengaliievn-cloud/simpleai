import { describe, it, expect } from 'vitest';
import { costUsd, chargeTiyn, formatTiyn, balanceLow, estimateAudioSeconds, modelInfo, DEFAULT_SETTINGS } from './billing.js';

const s = DEFAULT_SETTINGS; // 520 ₸/$, наценка ×2

describe('Баланс ИИ: стоимость', () => {
  it('ответ на gpt-5-mini: 2000 токенов вход, 200 выход', () => {
    const usd = costUsd({ provider: 'openai', model: 'gpt-5-mini', inputTokens: 2000, outputTokens: 200 }, s);
    expect(usd).toBeCloseTo((2000 * 0.25 + 200 * 2) / 1e6, 10); // $0.0009
    expect(chargeTiyn(usd, s)).toBe(94); // 0.0009 × 520 × 2 = 0.936 ₸ → 94 тиына
  });

  it('эмбеддинги и голосовые считаются по своей цене', () => {
    expect(costUsd({ provider: 'openai', model: 'gpt-5-mini', embedTokens: 1_000_000 }, s)).toBeCloseTo(0.02);
    expect(costUsd({ provider: 'gemini', model: 'gemini-3.6-flash', audioSeconds: 60 }, s)).toBeCloseTo(0.002);
  });

  it('цену модели можно переопределить в настройках', () => {
    const custom = { ...s, prices: { 'gpt-5-mini': { inUsd: 1, outUsd: 1 } } };
    expect(modelInfo('gpt-5-mini', custom)?.inUsd).toBe(1);
    expect(costUsd({ provider: 'openai', model: 'gpt-5-mini', inputTokens: 1_000_000 }, custom)).toBeCloseTo(1);
  });

  it('неизвестная модель — по самой дорогой цене, а не бесплатно', () => {
    expect(costUsd({ provider: 'openai', model: 'gpt-какая-то', outputTokens: 1_000_000 }, s)).toBeCloseTo(10);
  });

  it('ненулевой вызов — минимум 1 тиын, нулевой — 0', () => {
    expect(chargeTiyn(0.0000001, s)).toBe(1);
    expect(chargeTiyn(0, s)).toBe(0);
  });
});

describe('Баланс ИИ: показ и предупреждения', () => {
  it('формат суммы', () => {
    expect(formatTiyn(500000)).toBe('5 000 ₸');
    expect(formatTiyn(94)).toBe('0,94 ₸');
    expect(formatTiyn(-1250)).toBe('-12,50 ₸');
  });
  it('«мало» — меньше 10% от последнего пополнения или ноль', () => {
    expect(balanceLow(40000, 500000)).toBe(true);
    expect(balanceLow(60000, 500000)).toBe(false);
    expect(balanceLow(0, 0)).toBe(true);
    expect(balanceLow(100, 0)).toBe(false);
  });
  it('длительность голосового по размеру файла', () => {
    expect(estimateAudioSeconds(20_000)).toBe(10);
  });
});
