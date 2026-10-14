import { describe, expect, it } from 'vitest';
import { fmtTaipei, isWork, nextDeparture, taipei, toBusiness, DEFAULT_CALENDAR, HOLIDAY_ENTRIES, at } from '../src/index.ts';

const T = taipei;

describe('時區：伺服器跑在 UTC 也要用臺北時間計算', () => {
  it('測試程序確實跑在 UTC', () => {
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });
  it('臺北 12:00 = UTC 04:00', () => {
    expect(T('2026-10-14T12:00')).toBe(Date.UTC(2026, 9, 14, 4, 0));
  });
  it('臺北 00:30 在 UTC 還是前一天，日期要算臺北的', () => {
    const t = T('2026-10-17T00:30'); // 週六臺北凌晨；UTC 是週五 16:30
    expect(new Date(t).getUTCDay()).toBe(5);
    expect(isWork(t)).toBe(false);
    expect(nextDeparture(t)).toBe(T('2026-10-19T12:00'));
  });
  it('換成其他伺服器時區結果不變', () => {
    const before = nextDeparture(T('2026-10-16T18:01'));
    const old = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(new Date(0).getTimezoneOffset()).not.toBe(0);
      expect(nextDeparture(T('2026-10-16T18:01'))).toBe(before);
      expect(at(T('2026-10-16T18:01'), 9)).toBe(T('2026-10-16T09:00'));
    } finally {
      process.env.TZ = old;
    }
  });
});

describe('nextDeparture：寄出後最近的發車（12:00／15:00／18:00，工作日）', () => {
  const cases: [string, string, string][] = [
    ['週三 08:00', '2026-10-14T08:00', '2026-10-14T12:00'],
    ['週三 11:59 趕上 12:00 班', '2026-10-14T11:59', '2026-10-14T12:00'],
    ['週三 12:00 整搭 12:00 班', '2026-10-14T12:00', '2026-10-14T12:00'],
    ['週三 12:00:01 等 15:00 班', '2026-10-14T12:00:01', '2026-10-14T15:00'],
    ['週三 15:00 整', '2026-10-14T15:00', '2026-10-14T15:00'],
    ['週三 17:59', '2026-10-14T17:59', '2026-10-14T18:00'],
    ['週三 18:00 整搭末班', '2026-10-14T18:00', '2026-10-14T18:00'],
    ['週三 18:01 錯過末班，隔天 12:00', '2026-10-14T18:01', '2026-10-15T12:00'],
    ['週三 23:59', '2026-10-14T23:59', '2026-10-15T12:00'],
    ['週五 18:01 寄，下週一 12:00', '2026-10-16T18:01', '2026-10-19T12:00'],
    ['週五 21:00 寄，下週一 12:00', '2026-10-16T21:00', '2026-10-19T12:00'],
    ['週六寄，下週一', '2026-10-17T10:00', '2026-10-19T12:00'],
    ['週日寄，下週一', '2026-10-18T23:00', '2026-10-19T12:00'],
    ['國慶連假前（10/8 週四晚上），連假後週一', '2026-10-08T19:00', '2026-10-12T12:00'],
    ['國慶補假當天（10/9 週五）', '2026-10-09T10:00', '2026-10-12T12:00'],
    ['春節連假前（2/13 週五晚上），2/23 週一', '2026-02-13T18:30', '2026-02-23T12:00'],
    ['跨年：12/31 晚上寄，元旦放假，2027/1/4 週一', '2026-12-31T20:00', '2027-01-04T12:00'],
    ['跨年：12/31 下午寄，趕上 15:00 班', '2026-12-31T14:00', '2026-12-31T15:00'],
    ['和平紀念日補假 2/27', '2026-02-26T18:30', '2026-03-02T12:00'],
  ];
  it.each(cases)('%s', (_label, sent, want) => {
    expect(fmtTaipei(nextDeparture(T(sent)))).toBe(fmtTaipei(T(want)));
  });
});

describe('toBusiness：送達時間推到上班時間（9:00–18:00，18:00 整算下班）', () => {
  const cases: [string, string, string][] = [
    ['上班中不動', '2026-10-14T10:30', '2026-10-14T10:30'],
    ['9:00 整不動', '2026-10-14T09:00', '2026-10-14T09:00'],
    ['8:59 推到 9:00', '2026-10-14T08:59', '2026-10-14T09:00'],
    ['17:59 還在上班', '2026-10-14T17:59', '2026-10-14T17:59'],
    ['18:00 整算下班，順延隔天 9:00', '2026-10-14T18:00', '2026-10-15T09:00'],
    ['18:00:00.001 也順延', '2026-10-14T18:00:00.001', '2026-10-15T09:00'],
    ['週五 18:00 順延到週一', '2026-10-16T18:00', '2026-10-19T09:00'],
    ['週六中午順延到週一', '2026-10-17T12:00', '2026-10-19T09:00'],
    ['連假中順延到連假後', '2026-10-10T15:00', '2026-10-12T09:00'],
    ['跨年夜順延到 2027/1/4', '2026-12-31T18:00', '2027-01-04T09:00'],
    ['春節中順延', '2026-02-18T11:00', '2026-02-23T09:00'],
  ];
  it.each(cases)('%s', (_label, raw, want) => {
    expect(fmtTaipei(toBusiness(T(raw)))).toBe(fmtTaipei(T(want)));
  });
});

describe('行事曆資料', () => {
  it('2026、2027 都有資料，日期格式正確且不重複', () => {
    const dates = HOLIDAY_ENTRIES.map((h) => h.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect(dates.some((d) => d.startsWith('2026'))).toBe(true);
    expect(dates.some((d) => d.startsWith('2027'))).toBe(true);
  });
  it('可以注入自己的行事曆（例如颱風假）', () => {
    const cal = { holidays: new Set([...DEFAULT_CALENDAR.holidays, '2026-10-15']) };
    expect(nextDeparture(T('2026-10-14T18:01'), cal)).toBe(T('2026-10-16T12:00'));
  });
  it('補班日（週六）視為工作日', () => {
    const cal = { holidays: DEFAULT_CALENDAR.holidays, makeupWorkdays: new Set(['2026-10-17']) };
    expect(nextDeparture(T('2026-10-16T18:01'), cal)).toBe(T('2026-10-17T12:00'));
  });
});
