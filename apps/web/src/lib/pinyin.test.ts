import { describe, expect, it } from 'vitest';
import { candidates, PinyinComposer, type PinyinState } from './pinyin.ts';

function setup() {
  const out: string[] = [];
  let last: PinyinState | null = null;
  const p = new PinyinComposer(
    (t) => out.push(t),
    (s) => (last = s),
  );
  return { p, out, text: () => out.join(''), last: () => last! };
}

describe('拼音候選字', () => {
  it('完整音節：依字頻排，常用字在前', () => {
    expect(candidates('ni').chars.slice(0, 2)).toEqual(['你', '尼']);
    expect(candidates('shi').chars[0]).toBe('是');
    expect(candidates('de').chars[0]).toBe('的');
    expect(candidates('ni').take).toBe(2);
  });
  it('ü 用 v 打', () => expect(candidates('lv').chars).toContain('绿'));
  it('打到一半：合併所有開頭相同的音節', () => {
    const c = candidates('zh').chars;
    expect(c.slice(0, 3)).toContain('这');
    expect(c).toContain('中');
  });
  it('連打兩個音節：先給第一個音節的字', () => {
    const r = candidates('nihao');
    expect(r.take).toBe(2);
    expect(r.chars[0]).toBe('你');
  });
  it("撇號分音節：xi'an 先給 xi", () => {
    const r = candidates("xi'an");
    expect(r.take).toBe(2);
    expect(r.chars).toContain('西');
  });
  it('出來的都是簡體字', () => {
    expect(candidates('zhong').chars).toContain('种');
    expect(candidates('zhong').chars).not.toContain('種');
  });
  it('不是拼音就沒有候選', () => expect(candidates('vvv').chars).toEqual([]));
});

describe('拼音組字器', () => {
  it('空白選第一個、數字選第幾個', () => {
    const { p, text } = setup();
    p.feed('ni ');
    p.feed('hao1');
    expect(text()).toBe('你好');
    expect(p.active).toBe(false);
  });
  it('連打 nihao：選一個字，剩下的拼音留著', () => {
    const { p, text, last } = setup();
    p.feed('nihao ');
    expect(text()).toBe('你');
    expect(last().buf).toBe('hao');
    p.feed(' ');
    expect(text()).toBe('你好');
  });
  it('退格只刪組字中的拼音；沒在組字就交還（落子無悔）', () => {
    const { p, text, last } = setup();
    p.feed('nk');
    expect(p.backspace()).toBe(true);
    expect(last().buf).toBe('n');
    p.feed('i ');
    expect(text()).toBe('你');
    expect(p.backspace()).toBe(false);
    expect(text()).toBe('你');
  });
  it('翻頁：= 下一頁、- 上一頁', () => {
    const { p, last } = setup();
    p.feed('shi');
    const first = last().cands;
    expect(last().pages).toBeGreaterThan(1);
    p.feed('=');
    expect(last().page).toBe(1);
    expect(last().cands).not.toEqual(first);
    p.feed('-');
    expect(last().cands).toEqual(first);
  });
  it('組字中打標點：先選第一個字，再寫全形標點', () => {
    const { p, text } = setup();
    p.feed('hao,');
    expect(text()).toBe('好，');
  });
  it('沒在組字：標點換全形，中文照寫', () => {
    const { p, text } = setup();
    p.feed('.');
    p.feed('信');
    p.feed('?');
    expect(text()).toBe('。信？');
  });
  it('Enter：把字母原樣寫上去', () => {
    const { p, text } = setup();
    p.feed('ok\n');
    expect(text()).toBe('ok');
    p.feed('\n');
    expect(text()).toBe('ok\n');
  });
  it('大寫字母也當拼音', () => {
    const { p, text } = setup();
    p.feed('NI ');
    expect(text()).toBe('你');
  });
});
