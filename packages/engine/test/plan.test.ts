import { describe, expect, it } from 'vitest';
import {
  D,
  H,
  hourOf,
  isWork,
  mockWeatherOf,
  nextDeparture,
  plan,
  taipei,
  weatherFromTable,
  ymd,
  type PlanInput,
  type WeatherFn,
} from '../src/index.ts';

const T = taipei;
const clear: WeatherFn = () => 'clear';

const ship = (over: Partial<Omit<PlanInput, 'env'>> & { env?: Partial<PlanInput['env']> } = {}): PlanInput => ({
  no: over.no ?? 'RR123456785TW',
  sentAt: over.sentAt ?? T('2026-10-14T10:00'),
  office: over.office ?? '巷口郵筒',
  box: over.box ?? 'green',
  env: { fromEmail: 'zhe@example.com', toEmail: 'wen@example.org', fromAddr: '臺北市大安區', toAddr: '臺南市東區', ...over.env },
});

describe('plan：基礎天數（縣市距離表）', () => {
  const cases: [string, string, string, 'green' | 'red', number][] = [
    ['同縣市', '臺北市大安區', '台北市信義區', 'green', 1],
    ['同區域', '臺北市大安區', '新竹市東區', 'green', 2],
    ['跨區域', '臺北市大安區', '臺南市東區', 'green', 3],
    ['往返東部', '臺北市大安區', '花蓮縣花蓮市', 'green', 4],
    ['往返離島', '高雄市前鎮區', '金門縣金城鎮', 'green', 5],
    ['紅色限時郵筒少 1 天', '臺北市大安區', '臺南市東區', 'red', 2],
    ['同縣市限時最少 1 天', '臺北市大安區', '臺北市中山區', 'red', 1],
  ];
  it.each(cases)('%s', (_l, from, to, box, base) => {
    const p = plan(ship({ box, env: { fromAddr: from, toAddr: to } }), { weather: clear });
    expect(p.base).toBe(base);
  });

  it('沒有實體地址：3～14 天隨機，地名用信箱網域', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const p = plan(ship({ no: `seed-${i}`, env: { fromAddr: '', toAddr: '' } }), { weather: clear });
      expect(p.base).toBeGreaterThanOrEqual(3);
      expect(p.base).toBeLessThanOrEqual(14);
      seen.add(p.base);
      expect(p.dest).toBe('example.org');
      expect(p.stops[p.stops.length - 1]).toBe('example.org 投遞所');
    }
    expect(seen.size).toBe(12); // 3..14 都出現過
  });

  it('只有一端有地址也當作沒有地址', () => {
    const p = plan(ship({ env: { toAddr: '' } }), { weather: clear });
    expect(p.baseWhy).toContain('沒有兩端實體地址');
  });

  it('地址不在臺灣縣市表：5～14 天', () => {
    for (let i = 0; i < 100; i++) {
      const p = plan(ship({ no: `x${i}`, env: { toAddr: 'Tokyo Shibuya' } }), { weather: clear });
      expect(p.base).toBeGreaterThanOrEqual(5);
      expect(p.base).toBeLessThanOrEqual(14);
    }
  });

  it('沿途據點：跨區要經過兩個處理中心', () => {
    const p = plan(ship(), { weather: clear });
    expect(p.stops).toEqual(['臺北大安區 巷口郵筒', '臺北郵件處理中心', '高雄郵件處理中心', '臺南東區郵局 投遞股']);
  });
});

describe('plan：送達時間', () => {
  it('從最近的發車班次起算', () => {
    const s = ship({ sentAt: T('2026-10-16T18:01') });
    expect(plan(s, { weather: clear }).start).toBe(T('2026-10-19T12:00'));
  });

  it('同樣的輸入永遠得到同樣的計畫（決定性）', () => {
    expect(plan(ship())).toEqual(plan(ship()));
  });

  it('送達一定落在工作日 9:00–18:00（18:00 整不算），且不早於 raw', () => {
    for (let i = 0; i < 600; i++) {
      const sentAt = T('2026-09-01T00:00') + ((i * 7919 * 60_000) % (200 * D));
      const p = plan(ship({ no: `RR${i}`, sentAt, env: i % 3 ? {} : { fromAddr: '', toAddr: '' } }), {
        weather: mockWeatherOf,
      });
      expect(isWork(p.deliver)).toBe(true);
      expect(hourOf(p.deliver)).toBeGreaterThanOrEqual(9);
      expect(hourOf(p.deliver)).toBeLessThan(18);
      expect(p.deliver).toBeGreaterThanOrEqual(p.raw);
      expect(p.start).toBe(nextDeparture(sentAt));
      expect(p.randDelay).toBeGreaterThanOrEqual(0);
      expect(p.randDelay).toBeLessThanOrEqual(48 * H);
      expect(p.raw).toBe(p.start + p.base * D + p.randDelay + p.wDelay);
      // 事件依時間排序，最後一筆是投遞
      const ts = p.events.map((e) => e.t);
      expect([...ts].sort((a, b) => a - b)).toEqual(ts);
      expect(p.events.at(-1)!.tx).toBe('已投遞至收件人電子信箱');
    }
  });

  it('週五晚上寄：下週一才發車，送達也在工作日', () => {
    const p = plan(ship({ sentAt: T('2026-10-16T22:00') }), { weather: clear });
    expect(ymd(p.start)).toBe('2026-10-19');
    expect(isWork(p.deliver)).toBe(true);
  });

  it('跨年寄：2027 年才送達', () => {
    const p = plan(ship({ sentAt: T('2026-12-31T19:00') }), { weather: clear });
    expect(ymd(p.start)).toBe('2027-01-04');
    expect(ymd(p.deliver) >= '2027-01-05').toBe(true);
  });
});

describe('plan：天氣延遲', () => {
  const base = ship({ sentAt: T('2026-08-03T10:00') }); // 週一，颱風季
  const dayAfterStart = '2026-08-04';

  it('颱風：剛好 +1 天', () => {
    const a = plan(base, { weather: clear });
    const b = plan(base, { weather: weatherFromTable({ [dayAfterStart]: 'typhoon' }) });
    expect(b.wDelay).toBe(D);
    expect(b.raw - a.raw).toBe(D);
    expect(b.events.some((e) => e.tx.includes('颱風'))).toBe(true);
  });

  it('兩天颱風 +2 天', () => {
    const b = plan(base, { weather: weatherFromTable({ '2026-08-04': 'typhoon', '2026-08-05': 'typhoon' }) });
    expect(b.wDelay).toBe(2 * D);
  });

  it.each(['rain', 'snow'] as const)('%s：一天 +2～6 小時', (kind) => {
    for (let i = 0; i < 200; i++) {
      const s = { ...base, no: `w${i}` };
      const a = plan(s, { weather: clear });
      const b = plan(s, { weather: weatherFromTable({ [dayAfterStart]: kind }) });
      expect(b.wDelay).toBeGreaterThanOrEqual(2 * H);
      expect(b.wDelay).toBeLessThanOrEqual(6 * H);
      expect(b.raw - a.raw).toBe(b.wDelay);
    }
  });

  it('送達日之後的天氣不影響', () => {
    const a = plan(base, { weather: clear });
    const b = plan(base, { weather: weatherFromTable({ '2026-12-01': 'typhoon' }) });
    expect(b.raw).toBe(a.raw);
  });

  it('模擬天氣是決定性的，且只在 7–10 月出現颱風、12–2 月才有雪', () => {
    for (let d = T('2026-01-01T00:00'); d < T('2027-01-01T00:00'); d += D) {
      const w = mockWeatherOf(d, '臺南');
      expect(mockWeatherOf(d, '臺南')).toBe(w);
      const m = Number(ymd(d).slice(5, 7));
      if (w === 'typhoon') expect(m >= 7 && m <= 10).toBe(true);
      if (w === 'snow') expect(m === 12 || m <= 2).toBe(true);
    }
  });

  it('可以注入自己的快遞天數來源', () => {
    const p = plan(base, { weather: clear, courier: () => ({ base: 7, why: '外部 API' }) });
    expect(p.base).toBe(7);
    expect(p.baseWhy).toBe('外部 API');
  });
});
