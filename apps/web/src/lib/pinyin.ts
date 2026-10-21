/**
 * 拼音鍵盤（簡體）：打羅馬拼音、選候選字，寫到紙上的是簡體字。
 * 字典是 4,500 個常用簡體字，候選依字頻排（資料：Jun Da 現代漢語字頻表，經 hanzi 套件取得；產生方式見 docs）。
 * 組字中的拼音還沒寫到紙上，所以可以退格；選定的字一送出就落子無悔。
 */
import DATA from './pinyin-data.json';

const D = DATA as Record<string, string>;
/** 全部字，依字頻 */
const ORDER = D._ ?? '';
const RANK: Record<string, number> = {};
[...ORDER].forEach((c, i) => (RANK[c] = i));
const SYLLABLES = Object.keys(D).filter((k) => k !== '_');

export const PAGE = 8;
const MAX_BUF = 24;

/** 拼音鍵盤下的半形標點換成全形 */
export const PY_PUNCT: Record<string, string> = {
  ',': '，',
  '.': '。',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
  '(': '（',
  ')': '）',
  '<': '《',
  '>': '》',
  '\\': '、',
  '[': '「',
  ']': '」',
  '{': '『',
  '}': '』',
  '~': '～',
  $: '￥',
};

/**
 * 這串拼音的候選字，以及選了之後要吃掉幾個字母。
 * - 剛好是一個音節：那個音節的字
 * - 打到一半（zh、xia）：所有以它開頭的音節的字，依字頻合併
 * - 連打好幾個音節（nihao）：取最長的合法開頭（ni），剩下的留著
 * - 撇號 ' 可以手動分音節（xi'an）
 */
export function candidates(buf: string): { chars: string[]; take: number } {
  const ap = buf.indexOf("'");
  const seg = ap >= 0 ? buf.slice(0, ap) : buf;
  if (!seg) return { chars: [], take: ap >= 0 ? 1 : 0 };
  const exact = D[seg];
  if (exact) return { chars: [...exact], take: seg.length };
  if (ap < 0) {
    const pre = SYLLABLES.filter((s) => s.startsWith(seg));
    if (pre.length) {
      const set = new Set<string>();
      pre.forEach((s) => [...D[s]!].forEach((c) => set.add(c)));
      return { chars: [...set].sort((a, b) => (RANK[a] ?? 1e9) - (RANK[b] ?? 1e9)), take: seg.length };
    }
  }
  for (let n = seg.length - 1; n > 0; n--) {
    const s = D[seg.slice(0, n)];
    if (s) return { chars: [...s], take: n };
  }
  return { chars: [], take: 0 };
}

export interface PinyinState {
  /** 組字中的拼音（含撇號） */
  buf: string;
  /** 這一頁的候選字（最多 8 個） */
  cands: string[];
  page: number;
  pages: number;
}

/** 拼音組字器：餵進按鍵，選定的字從 out 送出 */
export class PinyinComposer {
  buf = '';
  page = 0;
  constructor(
    private readonly out: (text: string) => void,
    private readonly onChange: (s: PinyinState) => void = () => {},
  ) {}

  get active(): boolean {
    return this.buf.length > 0;
  }

  state(): PinyinState {
    const { chars } = candidates(this.buf);
    const pages = Math.max(1, Math.ceil(chars.length / PAGE));
    const page = Math.min(this.page, pages - 1);
    return { buf: this.buf, cands: chars.slice(page * PAGE, page * PAGE + PAGE), page, pages };
  }

  private emit(): void {
    this.onChange(this.state());
  }

  /** 從輸入框收到的一串字，一個一個處理 */
  feed(text: string): void {
    for (const ch of text) this.key(ch);
  }

  key(ch: string): void {
    if (/^[a-zA-Z]$/.test(ch)) {
      if (this.buf.length < MAX_BUF) this.buf += ch.toLowerCase();
      this.page = 0;
      this.emit();
      return;
    }
    if (!this.buf) {
      // 沒在組字：中文照寫，半形標點換全形
      this.out(PY_PUNCT[ch] ?? ch);
      return;
    }
    if (ch === "'") {
      if (!this.buf.endsWith("'")) this.buf += "'";
      this.emit();
    } else if (/^[1-8]$/.test(ch)) this.pick(Number(ch) - 1);
    else if (ch === ' ') this.pick(0);
    else if (ch === '\n') {
      // Enter：照打出來的字母寫上去
      const raw = this.buf.replace(/'/g, '');
      this.clear();
      this.out(raw);
    } else if (ch === '=' || ch === ']') this.turn(1);
    else if (ch === '-' || ch === '[') this.turn(-1);
    else {
      // 其他標點：先選第一個候選字，再寫標點
      this.pick(0);
      if (!this.buf) this.out(PY_PUNCT[ch] ?? ch);
    }
  }

  /** 選這一頁第 i 個候選字 */
  pick(i: number): void {
    const c = this.state().cands[i];
    if (!c) return;
    const { take } = candidates(this.buf);
    this.buf = this.buf.slice(take).replace(/^'+/, '');
    this.page = 0;
    this.out(c);
    this.emit();
  }

  turn(d: number): void {
    const { pages } = this.state();
    this.page = Math.max(0, Math.min(pages - 1, this.page + d));
    this.emit();
  }

  /** 退格：只刪組字中的拼音；沒在組字就回 false（交給落子無悔擋下） */
  backspace(): boolean {
    if (!this.buf) return false;
    this.buf = this.buf.slice(0, -1);
    this.page = 0;
    this.emit();
    return true;
  }

  clear(): void {
    if (!this.buf && !this.page) return;
    this.buf = '';
    this.page = 0;
    this.emit();
  }
}
