/**
 * 拼音鍵盤（簡體）：打羅馬拼音、選候選字，寫到紙上的是簡體字。
 * 字典是 4,500 個常用簡體字，候選依字頻排（資料：Jun Da 現代漢語字頻表，經 hanzi 套件取得；產生方式見 docs）。
 * 組字中的拼音還沒寫到紙上，所以可以退格；選定的字一送出就落子無悔。
 *
 * 詞組（backlog「拼音鍵盤加詞組」）：連打好幾個音節時（nihao、xihuan），先列出常用詞，再列單字。
 * 詞庫 pinyin-phrases.json（約 3 萬個詞，結巴詞典＋pinyin-pro 標音，產生方式見 scripts/gen-pinyin-phrases.mjs）
 * 有 500 多 KB，切到拼音鍵盤才載入；還沒載入時照樣只有單字。
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
let PHRASES: Record<string, string> | null = null;
let loading: Promise<void> | null = null;

/** 載入詞組（第一次用拼音鍵盤時） */
export function loadPhrases(): Promise<void> {
  loading ??= import('./pinyin-phrases.json').then((m) => {
    PHRASES = m.default as Record<string, string>;
  });
  return loading;
}
/** 測試用 */
export function setPhrases(d: Record<string, string> | null): void {
  PHRASES = d;
}

const MAX_PHRASES = 8;

/**
 * 詞組候選：從組字串開頭取最長的、詞庫裡有的拼音（至少兩個字母），由長到短列出。
 * 撇號不影響比對（xi'an 也找得到「西安」），但吃掉的長度要算進撇號。
 */
function phraseCands(buf: string): { text: string; take: number }[] {
  if (!PHRASES) return [];
  const letters = buf.replace(/'/g, '');
  const out: { text: string; take: number }[] = [];
  const seen = new Set<string>();
  for (let end = letters.length; end >= 2 && out.length < MAX_PHRASES; end--) {
    const hit = PHRASES[letters.slice(0, end)];
    if (!hit) continue;
    // 原始字串（含撇號）裡，吃掉 end 個字母要吃到哪裡
    let take = 0;
    for (let n = 0; take < buf.length && n < end; take++) if (buf[take] !== "'") n++;
    for (const w of hit.split(' ')) {
      if (!seen.has(w) && out.length < MAX_PHRASES) {
        seen.add(w);
        out.push({ text: w, take });
      }
    }
  }
  return out;
}

/** 候選字與詞：每個候選各自記得選了之後吃掉幾個字母（詞組吃得比單字多） */
export function candidateList(buf: string): { text: string; take: number }[] {
  const single = candidates(buf);
  const phrases = phraseCands(buf).filter((p) => p.take > single.take || [...p.text].length > 1);
  return [...phrases, ...single.chars.map((c) => ({ text: c, take: single.take }))];
}

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

  /** 詞組載入之後（書桌切到拼音鍵盤時呼叫 loadPhrases），讓畫面上的候選更新一次 */
  refresh(): void {
    if (this.buf) this.emit();
  }

  get active(): boolean {
    return this.buf.length > 0;
  }

  state(): PinyinState {
    const list = candidateList(this.buf);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const page = Math.min(this.page, pages - 1);
    return { buf: this.buf, cands: list.slice(page * PAGE, page * PAGE + PAGE).map((c) => c.text), page, pages };
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
    const list = candidateList(this.buf);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const c = list[Math.min(this.page, pages - 1) * PAGE + i];
    if (!c) return;
    this.buf = this.buf.slice(c.take).replace(/^'+/, '');
    this.page = 0;
    this.out(c.text);
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
