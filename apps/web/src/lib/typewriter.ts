/**
 * 古董打字機（鍵盤輸入、拼音鍵盤）。移植自原型 buildTW／pressKey／clack／strike。
 * 只負責外觀與聲音；真正寫到紙上的字由書桌送成追加操作。
 */
import { anim, RM } from './motion.ts';
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
  <div class="tw-py" data-tw="py" aria-live="polite"><span class="py-buf" data-tw="pybuf"></span><span class="py-cands" data-tw="pycands">${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<i data-n="${i}" data-pick="${i - 1}"></i>`).join('')}</span><span class="py-pg" data-tw="pypg"></span></div>
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
  /** 拼音鍵盤：組字中的拼音與這一頁候選字 */
  pinyin(st: { buf: string; cands: string[]; page: number; pages: number }): void {
    const b = $('[data-tw="pybuf"]', this.root),
      cs = $('[data-tw="pycands"]', this.root),
      pg = $('[data-tw="pypg"]', this.root);
    if (b) b.textContent = st.buf;
    if (cs) $$('i', cs).forEach((x, i) => (x.textContent = st.buf ? (st.cands[i] ?? '') : ''));
    if (pg) pg.textContent = st.buf && st.pages > 1 ? `${st.page + 1}/${st.pages}` : '';
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
  /** 移動打字頭（捲紙、推滑架）：喀啦一聲、滾筒晃一下；推到紙邊推不動時叮一聲 */
  carriage(edge = false): void {
    if (edge) {
      clack(this.sound(), 'ding');
      return;
    }
    clack(this.sound(), 'space');
    const pl = $('.tw-platen', this.root);
    if (pl && !RM) anim(pl, [{ transform: 'none' }, { transform: 'translateX(-4px) rotate(-1deg)', offset: 0.4 }, { transform: 'none' }], { d: 300, e: 'ease-out' });
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
