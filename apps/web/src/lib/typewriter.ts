/**
 * 古董打字機（鍵盤輸入模式）與中文打字機字盤（台灣繁體／中國簡體）。移植自原型 buildTW／pressKey／clack／strike／renderTray／trayRun。
 * 只負責外觀、聲音與「找字」的慢動作；真正寫到紙上的字交給 onType（再由書桌送成追加操作）。
 */
import { anim, INOUT, RM, wait } from './motion.ts';
import { $, $$ } from './util.ts';

const TWROWS: [string, string, string, number?][][] = [
  [
    ['Digit1', 'ㄅ', '1'],
    ['Digit2', 'ㄉ', '2'],
    ['Digit3', 'ˇ', '3'],
    ['Digit4', 'ˋ', '4'],
    ['Digit5', 'ㄓ', '5'],
    ['Digit6', 'ˊ', '6'],
    ['Digit7', '˙', '7'],
    ['Digit8', 'ㄚ', '8'],
    ['Digit9', 'ㄞ', '9'],
    ['Digit0', 'ㄢ', '0'],
    ['Minus', 'ㄦ', '-'],
  ],
  [
    ['KeyQ', 'ㄆ', 'Q'],
    ['KeyW', 'ㄊ', 'W'],
    ['KeyE', 'ㄍ', 'E'],
    ['KeyR', 'ㄐ', 'R'],
    ['KeyT', 'ㄔ', 'T'],
    ['KeyY', 'ㄗ', 'Y'],
    ['KeyU', 'ㄧ', 'U'],
    ['KeyI', 'ㄛ', 'I'],
    ['KeyO', 'ㄟ', 'O'],
    ['KeyP', 'ㄣ', 'P'],
  ],
  [
    ['KeyA', 'ㄇ', 'A'],
    ['KeyS', 'ㄋ', 'S'],
    ['KeyD', 'ㄎ', 'D'],
    ['KeyF', 'ㄑ', 'F'],
    ['KeyG', 'ㄕ', 'G'],
    ['KeyH', 'ㄘ', 'H'],
    ['KeyJ', 'ㄨ', 'J'],
    ['KeyK', 'ㄜ', 'K'],
    ['KeyL', 'ㄠ', 'L'],
    ['Semicolon', 'ㄤ', ';'],
    ['Enter', '↵', '', 1],
  ],
  [
    ['KeyZ', 'ㄈ', 'Z'],
    ['KeyX', 'ㄌ', 'X'],
    ['KeyC', 'ㄏ', 'C'],
    ['KeyV', 'ㄒ', 'V'],
    ['KeyB', 'ㄖ', 'B'],
    ['KeyN', 'ㄙ', 'N'],
    ['KeyM', 'ㄩ', 'M'],
    ['Comma', 'ㄝ', ','],
    ['Period', 'ㄡ', '.'],
    ['Slash', 'ㄥ', '/'],
  ],
];

/** 民國風格的明快打字機：部首鍵 */
const RAD: Record<string, string> = Object.fromEntries(
  [...'一二三四五六七八丶丿乙']
    .map((r, i) => [['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus'][i]!, r])
    .concat(
      [...'言口木氵扌亻日月火土'].map((r, i) => ['Key' + 'QWERTYUIOP'[i], r]),
      [...'金女糸艹竹宀禾目石山'].map((r, i) => [i < 9 ? 'Key' + 'ASDFGHJKL'[i] : 'Semicolon', r]),
      [...'王心足車馬食衣雨門尸'].map((r, i) => [['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'][i]!, r]),
      [['Enter', '換行']],
    ),
);

export function typewriterHTML(): string {
  const fan = Array.from({ length: 37 }, (_, i) => {
    const t = (i / 36 - 0.5) * 2.5,
      x = 100 + Math.sin(t) * 96,
      y = 78 - Math.cos(t) * 30,
      hx = 100 + (x - 100) * 0.42,
      hy = y - (y - 8) * 0.42;
    return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}"/><rect x="${(hx - 1.6).toFixed(1)}" y="${(hy - 3).toFixed(1)}" width="3.2" height="5" rx="1" transform="rotate(${(t * 57.3).toFixed(0)} ${hx.toFixed(1)} ${hy.toFixed(1)})"/>`;
  }).join('');
  return `<div class="tw-body"><span class="tw-spool l"></span><span class="tw-spool r"></span><span class="tw-platen"></span><span class="tw-lever"></span><span class="tw-ding">叮</span><div class="tw-basket"><svg viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true"><path d="M2 80 Q2 4 100 4 Q198 4 198 80Z" fill="#050505"/><path d="M2 80 Q2 4 100 4 Q198 4 198 80" fill="none" stroke="#B8973F" stroke-width="1.2"/><g stroke="#8d908e" stroke-width="1.3" fill="#c9ccca">${fan}</g></svg><span class="tw-guide"><span class="tw-slug" data-tw="slug"></span></span><span class="tw-bar" data-tw="bar"></span></div><span class="tw-decal">慢信</span><div class="tw-eye" aria-hidden="true"><span class="eye-comp" data-tw="comp"></span><span class="eye-cells" data-tw="cells">${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<i data-n="${i}"></i>`).join('')}</span></div><span class="tw-decal2">華文打字機</span>
  <button type="button" class="tw-snd" data-tw="snd" aria-pressed="true" aria-label="打字聲">聲音</button>
  <div class="tw-keys">${TWROWS.map((r) => `<div class="tw-row">${r.map(([c, z, l, w]) => `<span class="k${w ? ' wide' : ''}" data-code="${c}"><b class="zy">${z}</b><b class="rad">${RAD[c] || z}</b>${l ? `<small>${l}</small>` : ''}</span>`).join('')}</div>`).join('')}</div>
  <div class="tw-space"><span class="k" data-code="Space"></span></div></div>`;
}

let AC: AudioContext | null = null;

/** 打字聲：用雜訊合成的喀噠、換行、叮 */
export function clack(sound: boolean, kind?: 'ding' | 'return' | 'space' | ''): void {
  if (!sound) return;
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = W.AudioContext || W.webkitAudioContext;
    if (!Ctor) return;
    AC = AC || new Ctor();
    if (AC.state === 'suspended') void AC.resume();
    const t = AC.currentTime,
      out = AC.destination;
    if (kind === 'ding') {
      const o = AC.createOscillator(),
        g = AC.createGain();
      o.type = 'sine';
      o.frequency.value = 2093;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.4);
      return;
    }
    const len = kind === 'return' ? 0.32 : 0.045,
      buf = AC.createBuffer(1, Math.round(AC.sampleRate * len), AC.sampleRate),
      d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const k = i / d.length;
      d[i] = (Math.random() * 2 - 1) * (kind === 'return' ? Math.sin(k * Math.PI) * 0.5 * (1 + Math.sin(k * 120)) : Math.pow(1 - k, 5));
    }
    const src = AC.createBufferSource();
    src.buffer = buf;
    const bp = AC.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'space' ? 700 : kind === 'return' ? 1200 : 1500 + Math.random() * 1200;
    bp.Q.value = kind === 'return' ? 0.7 : 1.4;
    const g = AC.createGain();
    g.gain.value = kind === 'return' ? 0.5 : 0.55;
    src.connect(bp).connect(g).connect(out);
    src.start(t);
  } catch {
    /* 沒有聲音也沒關係 */
  }
}

/** 掛在 #tw 上的打字機外觀 */
export class Typewriter {
  private keys: Record<string, HTMLElement & { _t?: ReturnType<typeof setTimeout> }> = {};
  lastKeyAt = 0;
  constructor(
    private readonly root: HTMLElement,
    private readonly sound: () => boolean,
  ) {
    root.innerHTML = typewriterHTML();
    $$('.k', root).forEach((k) => (this.keys[k.dataset.code!] = k));
  }
  has(code: string): boolean {
    return !!this.keys[code];
  }
  get keyCodes(): string[] {
    return Object.keys(this.keys);
  }
  pressKey(code: string, hold = false): boolean {
    const k = this.keys[code];
    if (!k) return false;
    k.classList.add('down');
    clearTimeout(k._t);
    if (!hold) k._t = setTimeout(() => k.classList.remove('down'), 110);
    return true;
  }
  releaseKey(code: string): void {
    const k = this.keys[code];
    if (k) {
      clearTimeout(k._t);
      k._t = setTimeout(() => k.classList.remove('down'), 40);
    }
  }
  /** 魔眼：最近打的八個字 */
  eye(chars: { c: string }[]): void {
    const c = $('[data-tw="cells"]', this.root);
    if (!c) return;
    const chs = chars.filter((o) => o.c !== '\n' && o.c.trim()).slice(-8);
    $$('i', c).forEach((x, i) => {
      x.textContent = chs[i] ? chs[i]!.c : '';
      x.classList.toggle('now', i === chs.length - 1);
    });
  }
  comp(text: string | null): void {
    const ec = $('[data-tw="comp"]', this.root);
    if (ec) ec.textContent = text || '';
  }
  setSoundPressed(on: boolean): void {
    $('[data-tw="snd"]', this.root)?.setAttribute('aria-pressed', String(on));
  }
  /** 字錘敲下去；換行時拉桿、叮一聲 */
  strike(ch: string, chars: { c: string }[]): void {
    const sl = $('[data-tw="slug"]', this.root),
      bar = $('[data-tw="bar"]', this.root);
    if (!sl) return;
    if (ch === '\n') {
      const lv = $('.tw-lever', this.root),
        dg = $('.tw-ding', this.root);
      if (lv) anim(lv, [{ transform: 'rotate(-24deg)' }, { transform: 'rotate(-50deg)', offset: 0.3 }, { transform: 'rotate(-24deg)' }], { d: 420, e: 'ease-out' });
      if (dg)
        anim(
          dg,
          [
            { opacity: 0, transform: 'translateY(4px) scale(.8)' },
            { opacity: 1, transform: 'translateY(-6px) scale(1.15)', offset: 0.25 },
            { opacity: 0, transform: 'translateY(-14px)' },
          ],
          { d: 900, e: 'ease-out' },
        );
      this.pressKey('Enter');
      clack(this.sound(), 'return');
      setTimeout(() => clack(this.sound(), 'ding'), 180);
      return;
    }
    sl.textContent = ch.trim() ? ch : '';
    this.eye(chars);
    const nw = $('[data-tw="cells"] .now', this.root);
    if (nw && !RM) anim(nw, [{ transform: 'scale(1.5)', filter: 'brightness(1.6)' }, { transform: 'none', filter: 'none' }], { d: 320, e: 'ease-out' });
    if (!RM) {
      anim(
        sl,
        [
          { transform: 'translateY(60%) scale(.6)', opacity: 0.2 },
          { transform: 'translateY(-6%) scale(1.15)', opacity: 1, offset: 0.45 },
          { transform: 'none', opacity: 1 },
        ],
        { d: 160, e: 'ease-out' },
      );
      if (bar)
        anim(bar, [{ transform: 'rotate(70deg)', opacity: 0.9 }, { transform: 'rotate(0deg)', opacity: 1, offset: 0.5 }, { transform: 'rotate(70deg)', opacity: 0 }], {
          d: 170,
          e: 'cubic-bezier(.3,0,.3,1)',
        });
    }
  }
  /** 打完一批字：最後一個字敲下去；不是實體鍵盤打的就隨便按一顆鍵 */
  afterType(s: string, chars: { c: string }[]): void {
    const lastCh = s[s.length - 1];
    if (s.includes('\n')) this.strike('\n', chars);
    if (lastCh && lastCh !== '\n') this.strike(lastCh, chars);
    if (Date.now() - this.lastKeyAt > 200) {
      const ks = this.keyCodes.filter((c) => c.startsWith('Key'));
      this.pressKey(lastCh === ' ' || lastCh === '　' ? 'Space' : ks[Math.floor(Math.random() * ks.length)]!);
      clack(this.sound());
    }
  }
  /** 實體鍵盤按下：對應的鍵也壓下去 */
  onKey(e: KeyboardEvent, phase: 'down' | 'up'): void {
    const c = e.code || '';
    if (phase === 'up') {
      this.releaseKey(c);
      return;
    }
    if (e.repeat) return;
    if (c === 'Space' || c === 'Enter' || this.keys[c]) {
      this.pressKey(c, true);
      this.lastKeyAt = Date.now();
      if (c !== 'Enter') clack(this.sound(), c === 'Space' ? 'space' : '');
    }
  }
}

/* ---------- 中文打字機：字盤模式 ----------
   台灣：繁體鉛字，依部首排列（打字行的標準字盤）。
   中國：簡體鉛字，依「聯想排列」把常一起用的字擺在一塊（打字員自己重排字盤的做法）。
   打字員要在字盤上找到字、把字錘移過去、壓下打字桿；字盤上沒有的字，要從備用字盒夾出來。 */
export const TRAYS: Record<'tw' | 'cn', { name: string; sort: string; groups: [string, string][] }> = {
  tw: {
    name: '台灣中文打字機・繁體字盤',
    sort: '部首排列',
    groups: [
      ['一', '一七三上下不世並'],
      ['丿乙亅', '久之乎九也了事'],
      ['二亠', '二五些亮京'],
      ['人亻', '人今他代以件任休但住何作你來例便係信個們候借做停健傳像'],
      ['儿入八', '元兄先光兒入內全兩八公六共其具典'],
      ['冂冫几', '再冬冷凡'],
      ['刀刂力', '分切初別到刻前則剛創力加助努動勞'],
      ['十卜厂又', '十千午半南原去又友反取受'],
      ['口囗', '口古只叫可句另台史右司各合同名吃向吧否告呢味和哥哭哪唱問啊喜單嗎嘴器回因團國圖'],
      ['土士', '土在地坐城基堂報場士'],
      ['夕大女', '外多夜夠夢大天太夫失奇她好如妳妹姊姐始婆媽'],
      ['子宀', '子字孩學孫安完定客室家容宿寄密富實寫'],
      ['寸小尢尸山', '封對將小少尤就屋山'],
      ['工己巾干', '工左差己已市希帶常幫年幸'],
      ['广弓彳', '店度座康弟張強往很待後得從'],
      ['心忄', '心必忘忙快念怎思急怕息想您情意愛感慢應'],
      ['戈戶手扌', '我或成所房手才打找把拿換接提'],
      ['攴文斤方', '收放故教敢整文新方旅'],
      ['日曰', '日早明昨星是時晚景晴暖更書最會'],
      ['月木', '月有朋服望期本未村束東果校業樣樹機'],
      ['欠止歹', '次歡正此步歲死'],
      ['水氵', '水永求江沒法注洗活海消淚深清湖溫滿'],
      ['火灬', '火然無照熱燈點'],
      ['父牛犬', '爸物特猜'],
      ['玉田', '玩現理生用由男界留畢畫'],
      ['疒白皮目', '病白百的皮直相看真眼'],
      ['示禾穴立', '祝神禮福秋種空窗站'],
      ['竹米糸', '笑第等答算節簡紀約紅紙結給經續'],
      ['羊老而耳', '美老考而聞聲聽'],
      ['肉自至舌色', '能自至舍色'],
      ['艸', '花苦英茶草菜落著'],
      ['行衣襾', '行衣裡要'],
      ['見言', '見覺親言計記許訊話該說誰請讀變讓'],
      ['貝走足身車', '負買費走起路跑跳身車較'],
      ['辵', '近送這通連週進過道遠適還邊'],
      ['邑酉里金', '那都重量金錢'],
      ['長門阜', '長門開間關院陪'],
      ['隹雨青非', '難雖雨雪雲雯電需青靜非'],
      ['頁風飛食首', '須順題願風飛飯首'],
      ['馬高魚鳥黑', '馬高魚鳥黑'],
      ['雜', '臨知麼'],
    ],
  },
  cn: {
    name: '中國中文打字機・簡體字盤',
    sort: '聯想排列',
    groups: [
      ['人稱', '我你他她们的自己大家'],
      ['親人', '爸妈哥姐弟妹奶爷孩子朋友'],
      ['時間', '今天明昨年月日时候晚早上下午现在以前后再'],
      ['書信', '写信收到寄封邮局地址回复字纸笔读'],
      ['心情', '想念爱喜欢高兴难过心情怕对不起谢抱歉'],
      ['動作', '来去走见说话听看知道做给问等找帮带'],
      ['常用', '是有没了也都很还就会能要可这那什么一个些和跟吗呢吧啊只其实'],
      ['地方', '中国台北京学校公司车站路门里外边'],
      ['東西', '东西书照片花树饭茶水衣服钱'],
      ['數目', '二三四五六七八九十百千万几多少半'],
      ['生活', '工作生活学习吃喝睡觉病身体好累'],
      ['雜字', '雯业典礼结束妳传讯息临事敢怎'],
    ],
  },
};
const TRAY_PUNCT = '，。、；：？！「」『』（）—…';
export const T2S: Record<string, string> = {};
export const S2T: Record<string, string> = {};
(() => {
  const P =
    '們们個个來来為为時时說说這这還还會会對对學学國国書书寫写東东車车長长門门問问開开關关間间電电話话讓让認认識识讀读記记許许謝谢請请誰谁該该變变覺觉親亲見见現现買买費费負负樂乐歡欢難难雖虽雲云風风飛飞飯饭題题願愿順顺須须馬马魚鱼鳥鸟點点熱热燈灯無无愛爱應应歲岁歷历過过進进週周連连遠远適适邊边錢钱裡里後后從从張张強强幫帮帶带單单嗎吗圖图團团報报場场夢梦夠够媽妈孫孙實实將将樣样樹树機机畢毕業业禮礼結结紀纪約约紅红紙纸給给經经續续節节簡简聞闻聲声聽听訊讯臨临麼么傳传兒儿內内兩两剛刚創创動动勞劳員员習习體体雙双筆笔郵邮複复爺爷們们興兴過过氣气時时親亲';
  for (let i = 0; i < P.length; i += 2) {
    T2S[P[i]!] = P[i + 1]!;
    S2T[P[i + 1]!] = P[i]!;
  }
})();

export interface TrayDeps {
  /** 真的打到紙上（一個字或空格、換行） */
  type: (ch: string) => void;
  /** 能不能打（出門了、改錯中就不行） */
  canType: () => boolean;
  nag: (m: string) => void;
  mirror: () => boolean;
  setMirror: (on: boolean) => void;
}

/** 字盤：點字 → 字錘移過去 → 壓下打字桿；字盤上沒有的字從備用字盒夾出來（比較慢） */
export class Tray {
  private q: string[] = [];
  private busy = false;
  private alive = true;
  constructor(
    private readonly root: HTMLElement,
    readonly mode: 'tw' | 'cn',
    private readonly deps: TrayDeps,
  ) {
    const T = TRAYS[mode];
    const seen = new Set<string>(),
      cells = (g: string) =>
        [...g]
          .filter((c) => !seen.has(c) && seen.add(c))
          .map((c) => `<b class="tc" data-c="${c}">${c}</b>`)
          .join('');
    const mir = deps.mirror();
    root.innerHTML = `<div class="tray-top"><span class="tray-name">${T.name}<small>${T.sort}・約 ${[...new Set(T.groups.map((g) => g[1]).join(''))].length} 個常用字</small></span>
    <label class="tray-find">找字<input data-tray="find" autocomplete="off" spellcheck="false" placeholder="輸入要打的字"></label>
    <button type="button" class="btn small" data-k="space">空格</button><button type="button" class="btn small" data-k="nl">換行</button>
    <label class="tray-mir"><input type="checkbox" data-tray="mirror" ${mir ? 'checked' : ''}> 看反字</label></div>
    <div class="tray-bed${mir ? ' mirror' : ''}" data-tray="bed">${T.groups.map(([h, g]) => `<div class="tg"><span class="tg-h">${h}</span><span class="tg-cells">${cells(g)}</span></div>`).join('')}<div class="tg"><span class="tg-h">標點</span><span class="tg-cells">${[...TRAY_PUNCT].map((c) => `<b class="tc" data-c="${c}">${c}</b>`).join('')}</span></div><span class="tray-sel" data-tray="sel"></span></div>
    <div class="tray-foot"><span class="tray-spare" data-tray="spare">備用字盒</span><span class="hint">點字盤上的字：字錘移過去，壓下打字桿。字盤上沒有的字，在「找字」打進去，會從備用字盒夾出來，比較慢。</span></div>`;
    const bed = $('[data-tray="bed"]', root)!;
    bed.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.tc');
      if (c) this.type(c.dataset.c!);
    });
    $$<HTMLButtonElement>('[data-k]', root).forEach((b) => (b.onclick = () => this.type(b.dataset.k === 'nl' ? '\n' : '　')));
    const m = $<HTMLInputElement>('[data-tray="mirror"]', root)!;
    m.onchange = () => {
      deps.setMirror(m.checked);
      bed.classList.toggle('mirror', m.checked);
    };
    const f = $<HTMLInputElement>('[data-tray="find"]', root)!;
    let comp = false;
    const take = () => {
      const v = f.value;
      f.value = '';
      for (const ch of v) if (ch.trim()) this.type(ch);
    };
    f.addEventListener('compositionstart', () => (comp = true));
    f.addEventListener('compositionend', () => {
      comp = false;
      take();
    });
    f.addEventListener('input', (e) => {
      if (!(e as InputEvent).isComposing && !comp) take();
    });
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        take();
      }
    });
  }
  destroy(): void {
    this.alive = false;
    this.q = [];
  }
  type(ch: string): void {
    if (!this.deps.canType()) return;
    if (this.mode === 'cn') ch = T2S[ch] || ch;
    else ch = S2T[ch] || ch;
    this.q.push(ch);
    if (!this.busy) void this.run();
  }
  private async run(): Promise<void> {
    this.busy = true;
    while (this.q.length && this.alive) {
      const ch = this.q.shift()!,
        bed = $('[data-tray="bed"]', this.root),
        sel = $('[data-tray="sel"]', this.root);
      if (!bed || !sel) break;
      if (ch === '\n' || ch === '　') {
        this.deps.type(ch);
        await wait(ch === '\n' ? 420 : 160);
        continue;
      }
      const cell = $$<HTMLElement>('.tc', bed).find((x) => x.dataset.c === ch);
      if (cell) {
        const x = cell.offsetLeft,
          y = cell.offsetTop,
          x0 = parseFloat(sel.style.left) || x,
          y0 = parseFloat(sel.style.top) || y,
          dist = Math.hypot(x - x0, y - y0);
        const top = y - bed.clientHeight / 2;
        if (Math.abs(bed.scrollTop - top) > bed.clientHeight * 0.35 && typeof bed.scrollTo === 'function') bed.scrollTo({ top, behavior: RM ? 'auto' : 'smooth' });
        await anim(sel, [{ left: x0 + 'px', top: y0 + 'px' }, { left: x + 'px', top: y + 'px' }], { d: Math.min(1100, 260 + dist * 1.1), e: INOUT });
        sel.style.left = x + 'px';
        sel.style.top = y + 'px';
        sel.getAnimations?.().forEach((a) => a.cancel());
        await anim(sel, [{ scale: '1' }, { scale: '.8', offset: 0.4 }, { scale: '1' }], { d: 200 });
        cell.classList.add('hit');
        setTimeout(() => cell.classList.remove('hit'), 500);
      } else {
        const sp = $('[data-tray="spare"]', this.root);
        if (sp) {
          sp.classList.add('busy');
          this.deps.nag('「' + ch + '」不在字盤上，從備用字盒裡夾出來。');
          await anim(sp, [{ rotate: '0deg' }, { rotate: '-2deg' }, { rotate: '2deg' }, { rotate: '0deg' }], { d: 500 });
          await wait(1900);
          sp.classList.remove('busy');
        }
      }
      if (!this.alive) break;
      this.deps.type(ch);
      await wait(120);
    }
    this.busy = false;
  }
}
