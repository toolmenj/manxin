/** 中央氣象署一週預報（D-022）：容錯解析、縣市對應、失敗退回模擬天氣 */
import { mockWeatherOf, taipei } from '@manxin/engine';
import { describe, expect, it } from 'vitest';
import { CwaWeather, kindOfText, parseCwaWeek, toCounty } from '../src/services/weather.ts';

/** 新版欄位（PascalCase） */
const pascal = {
  success: 'true',
  records: {
    Locations: [
      {
        Location: [
          {
            LocationName: '臺南市',
            WeatherElement: [
              {
                ElementName: '天氣現象',
                Time: [
                  { StartTime: '2026-10-15T06:00:00+08:00', EndTime: '2026-10-15T18:00:00+08:00', ElementValue: [{ Weather: '多雲', WeatherCode: '04' }] },
                  { StartTime: '2026-10-15T18:00:00+08:00', EndTime: '2026-10-16T06:00:00+08:00', ElementValue: [{ Weather: '多雲短暫陣雨', WeatherCode: '08' }] },
                  { StartTime: '2026-10-16T06:00:00+08:00', EndTime: '2026-10-16T18:00:00+08:00', ElementValue: [{ Weather: '晴', WeatherCode: '01' }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};
/** 舊版欄位（camelCase） */
const camel = {
  records: {
    locations: [
      {
        location: [
          {
            locationName: '臺北市',
            weatherElement: [
              { elementName: 'Wx', time: [{ startTime: '2026-10-17 06:00:00', elementValue: [{ value: '陰時多雲短暫雨', measures: '' }] }] },
            ],
          },
        ],
      },
    ],
  },
};

describe('中央氣象署天氣', () => {
  it('新舊兩種欄位寫法都讀得到；同一天取最壞的時段', () => {
    expect(parseCwaWeek(pascal, '臺南市')).toEqual({ '2026-10-15': 'rain', '2026-10-16': 'clear' });
    expect(parseCwaWeek(camel, '臺北市')).toEqual({ '2026-10-17': 'rain' });
    expect(parseCwaWeek(pascal, '臺北市')).toEqual({});
  });

  it('天氣文字對應', () => {
    expect(kindOfText('午後短暫雷陣雨')).toBe('rain');
    expect(kindOfText('陰有雨或雪')).toBe('snow');
    expect(kindOfText('晴時多雲')).toBe('clear');
  });

  it('地址對應到縣市', () => {
    expect(toCounty('台南市東區')).toBe('臺南市');
    expect(toCounty('臺北')).toBe('臺北市');
    expect(toCounty('example.org')).toBeNull();
  });

  it('預報裡有的日子用預報，超過一週用模擬天氣；同一個縣市只問一次', async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(JSON.stringify(pascal), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const w = new CwaWeather('KEY', undefined, fake);
    const f = await w.prepare('臺南市東區');
    expect(f(taipei('2026-10-15T00:00'), '臺南')).toBe('rain');
    expect(f(taipei('2026-10-16T00:00'), '臺南')).toBe('clear');
    const far = taipei('2026-11-30T00:00');
    expect(f(far, '臺南')).toBe(mockWeatherOf(far, '臺南'));
    await w.prepare('臺南市北區');
    expect(calls).toBe(1);
  });

  it('沒有授權碼、認不出縣市、API 掛掉、格式看不懂：都退回模擬天氣，不會讓寄信失敗', async () => {
    const boom = (async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch;
    const weird = (async () => new Response('{"hello":1}', { status: 200 })) as unknown as typeof fetch;
    const warns: string[] = [];
    const log = { warn: (_o: object, m: string) => void warns.push(m) };
    expect(await new CwaWeather(undefined).prepare('臺南市')).toBe(mockWeatherOf);
    expect(await new CwaWeather('KEY', log, boom).prepare('火星')).toBe(mockWeatherOf);
    expect(await new CwaWeather('KEY', log, boom).prepare('臺南市')).toBe(mockWeatherOf);
    expect(await new CwaWeather('KEY', log, weird).prepare('臺南市')).toBe(mockWeatherOf);
    expect(warns).toHaveLength(2);
  });
});
