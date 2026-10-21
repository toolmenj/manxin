import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, TW_MODES } from './prefs.ts';

const KEY = 'manxin.prefs.v1';

describe('打字機種類', () => {
  afterEach(() => localStorage.clear());

  it('只剩鍵盤輸入與拼音鍵盤', () => expect(TW_MODES).toEqual(['keys', 'py']));

  it('舊版存的台灣／中國字盤退回鍵盤輸入，看反字的欄位丟掉', () => {
    for (const m of ['tw', 'cn']) {
      localStorage.setItem(KEY, JSON.stringify({ twMode: m, trayMirror: true, desk: 'white' }));
      const p = loadPrefs();
      expect(p.twMode).toBe('keys');
      expect(p.desk).toBe('white');
      expect('trayMirror' in p).toBe(false);
    }
  });

  it('拼音鍵盤照樣記得', () => {
    localStorage.setItem(KEY, JSON.stringify({ twMode: 'py' }));
    expect(loadPrefs().twMode).toBe('py');
  });

  it('沒有存過就用預設', () => expect(loadPrefs()).toEqual(DEFAULT_PREFS));
});
