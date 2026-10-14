/**
 * 書桌：打字機（鍵盤輸入＋IME、台灣字盤、中國字盤、備用字盒）、手寫、改錯、謄抄、舊信紙、先放著、附件。
 * 書寫只送三種追加操作（SheetWriter）。落子無悔的防護在 lib/noRegret.ts。
 */
import type { DiscardState, LetterDTO, MarkTool, SheetDTO, Stroke } from '@manxin/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, attachmentUrl, isApiError } from '../api/client.ts';
import { Html, SheetThumb } from '../components/common.tsx';
import { Confirm, FlipCard, ImageModal, RefModal, ScanEditor } from '../components/DeskModals.tsx';
import { readImg, toJpeg } from '../lib/image.ts';
import { eraDefaults, letterHas, loadCurrentLetter, ownSheet } from '../lib/letters.ts';
import { anim, INOUT, RM } from '../lib/motion.ts';
import { guardNoRegret, guardWritingArea } from '../lib/noRegret.ts';
import { buildPaper, drawInk, drawX, FONTS, hasContent, INKS, PENS, renderType, strokeDraw, type Paper } from '../lib/paper.ts';
import { DESKS, type DeskKind, type TwMode } from '../lib/prefs.ts';
import { trashScene } from '../lib/scenes.ts';
import { SheetWriter, type WriterStatus } from '../lib/sheetWriter.ts';
import { D, fmt } from '../lib/time.ts';
import { clack, Tray, Typewriter } from '../lib/typewriter.ts';
import { $$, el, hash, jit, uid } from '../lib/util.ts';
import { useApp } from '../state/app.tsx';

const STYLE_OPTS: [SheetDTO['style'], string][] = [
  ['lined', '橫線信紙'],
  ['bahang', '八行箋（直書）'],
  ['grid', '稿紙（16×20）'],
  ['plain', '空白'],
  ['custom', '自訂圖樣'],
];

const FIX_TOOLS: { t: MarkTool; label: string; style: React.CSSProperties; ch: string }[] = [
  { t: 's1', label: '單橫線', style: { textDecoration: 'line-through' }, ch: '字' },
  { t: 's2', label: '雙橫線', style: { textDecoration: 'line-through double' }, ch: '字' },
  { t: 'x', label: '打叉', style: {}, ch: '✕' },
  { t: 'blk', label: '塗黑', style: { background: '#2E343A', color: '#2E343A' }, ch: '字' },
];

const clampStrokePts = (pts: [number, number, number][]): [number, number, number][] =>
  pts.map(([x, y, p]) => [Math.min(1.1, Math.max(-0.1, x)), Math.min(2, Math.max(-0.1, y)), Math.min(1, Math.max(0, p))]);

export function DeskPage() {
  const app = useApp();
  const nav = useNavigate();
  const { prefs, setPrefs, toast, nag, openModal, closeModal } = app;
  const [L, setL] = useState<LetterDTO | null>(null);
  const [sheet, setSheet] = useState<SheetDTO | null>(null);
  const [saveStatus, setSaveStatus] = useState<WriterStatus>('idle');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fixMode, setFixMode] = useState(false);
  const [fixTool, setFixTool] = useState<MarkTool>('s1');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [unsent, setUnsent] = useState<LetterDTO[]>([]);
  const writer = useRef<SheetWriter | null>(null);

  const trip = L?.trip ?? null;
  const kbd = prefs.twMode === 'keys';

  /* ---------- 讀信、建立寫入佇列 ---------- */
  const attach = useCallback(
    (letter: LetterDTO) => {
      writer.current?.stop();
      const id = letter.id;
      writer.current = new SheetWriter(letter.sheet, {
        send: (op, seq) =>
          op.kind === 'chars'
            ? api.appendChars(id, op.text, seq)
            : op.kind === 'mark'
              ? api.appendMark(id, op.from, op.to, op.tool, seq)
              : api.appendStroke(id, op.stroke, seq),
        reload: async () => (await api.getLetter(id)).sheet,
        onChange: (d, st) => {
          setSheet(d);
          setSaveStatus(st);
        },
        onError: (m) => toast(m),
      });
      setL(letter);
      setSheet(letter.sheet);
    },
    [toast],
  );

  const reload = useCallback(async () => {
    try {
      const cur = await loadCurrentLetter(prefs.era);
      if (cur) attach(cur);
      setLoadErr(null);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
    api
      .listLetters('shelved')
      .then((r) => setUnsent(r.letters))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach]);

  useEffect(() => {
    void reload();
    return () => writer.current?.stop();
  }, [reload, app.timeVersion]);

  /** 換了信紙（謄抄）或重新讀信 */
  const setLetter = useCallback((letter: LetterDTO) => {
    setL(letter);
    if (writer.current && writer.current.sheetId !== letter.sheet.id) writer.current.reset(letter.sheet);
    else if (writer.current && !writer.current.pending) writer.current.reset(letter.sheet);
    else setSheet((s) => s ?? letter.sheet);
  }, []);

  const view = useMemo(() => (sheet ? ownSheet({ ...(L as LetterDTO), sheet }) : null), [sheet, L]);
  const locked = sheet ? hasContent(sheet) : false;

  /* ---------- 年代風格：空白信紙跟著換樣子（原型 setEra） ---------- */
  // 在別的頁面換了年代也算：記住「書桌上次照哪個年代擺紙」（原型 setEra 不管在哪一頁都會改書桌上的空白信紙）
  useEffect(() => {
    if (!L || !sheet) return;
    const applied = prefs.deskEra ?? '80s';
    if (applied === prefs.era) return;
    setPrefs({ deskEra: prefs.era });
    if (hasContent(sheet) || sheet.kind !== 'letter' || trip) return;
    const v = prefs.era;
    const p: { style?: SheetDTO['style']; font?: string } = {};
    if (v === 'minguo') {
      p.style = 'bahang';
      if (sheet.font === 'typewriter') p.font = 'lead';
    } else {
      if (sheet.style === 'bahang') p.style = 'lined';
      if (sheet.font === 'lead') p.font = 'typewriter';
    }
    if (Object.keys(p).length) void patchSheet(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.era, L?.id, sheet?.id]);

  /* ---------- 紙筆設定 ---------- */
  const patchSheet = async (p: Parameters<typeof api.patchSheet>[1]) => {
    if (!L) return;
    try {
      if (p.mode && writer.current) await writer.current.flush();
      const sh = await api.patchSheet(L.id, p);
      writer.current?.setMeta(sh);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const toolsFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet || toolsFor.current === sheet.id) return;
    toolsFor.current = sheet.id;
    setToolsOpen(!hasContent(sheet));
  }, [sheet]);

  useEffect(() => {
    if (sheet && sheet.mode !== 'type') setFixMode(false);
  }, [sheet]);

  /* ---------- 紙、打字機、字盤（命令式的 DOM，照原型畫） ---------- */
  const pwRef = useRef<HTMLDivElement>(null);
  const imeRef = useRef<HTMLTextAreaElement>(null);
  const twRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const paper = useRef<Paper | null>(null);
  const tw = useRef<Typewriter | null>(null);
  const tray = useRef<Tray | null>(null);
  const prevLen = useRef<{ id: string; n: number }>({ id: '', n: 0 });
  const st = useRef({ fixMode, fixTool, trip, sheet, prefs, kbd });
  st.current = { fixMode, fixTool, trip, sheet, prefs, kbd };

  const placeIme = useCallback(() => {
    const ime = imeRef.current,
      pw = pwRef.current;
    if (!ime || !pw) return;
    const c = pw.querySelector('#caret');
    if (!c) {
      ime.style.left = '0';
      ime.style.top = '0';
      return;
    }
    const pr = pw.getBoundingClientRect(),
      r = c.getBoundingClientRect();
    ime.style.left = Math.min(r.left - pr.left, pr.width - 40) + 'px';
    ime.style.top = r.top - pr.top - 2 + 'px';
  }, []);

  const focusIme = useCallback(() => {
    imeRef.current?.focus({ preventScroll: true });
    placeIme();
  }, [placeIme]);

  const typeChars = useCallback(
    (str: string) => {
      const s = st.current;
      if (s.trip || !s.sheet || s.sheet.mode !== 'type' || s.fixMode || !writer.current) return;
      const text = str.replace(/\r\n?/g, '\n');
      if (!text) return;
      writer.current.push({ kind: 'chars', text });
      const chars = writer.current.display().chars;
      tw.current?.afterType(text, chars);
      if (text.includes('\n') && !RM && paper.current) paper.current.p.animate([{ transform: 'none' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 340, easing: 'ease-out' });
      if (s.kbd) imeRef.current?.focus({ preventScroll: true });
    },
    [],
  );

  // 打字機外觀（只建一次）
  useEffect(() => {
    if (!twRef.current || tw.current) return;
    tw.current = new Typewriter(twRef.current, () => st.current.prefs.sound !== false);
    const t = twRef.current;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.tw-snd')) return;
      e.preventDefault();
      const k = (e.target as HTMLElement).closest<HTMLElement>('.k');
      if (k) tw.current?.pressKey(k.dataset.code!);
      const s = st.current;
      if (!s.trip && s.sheet?.mode === 'type' && !s.fixMode) focusIme();
    };
    t.addEventListener('pointerdown', down);
    const snd = t.querySelector<HTMLButtonElement>('[data-tw="snd"]');
    if (snd)
      snd.onclick = () => {
        const on = st.current.prefs.sound === false;
        setPrefs({ sound: on });
        tw.current?.setSoundPressed(on);
        if (on) clack(true);
      };
    tw.current.setSoundPressed(prefs.sound !== false);
    // 打字機只建一次，跟著書桌一起拆
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L ? 1 : 0]);

  // 字盤（換台灣／中國時重建）
  useEffect(() => {
    const root = trayRef.current;
    if (!root || prefs.twMode === 'keys') {
      tray.current?.destroy();
      tray.current = null;
      return;
    }
    if (tray.current?.mode === prefs.twMode) return;
    tray.current?.destroy();
    tray.current = new Tray(root, prefs.twMode, {
      type: (ch) => typeChars(ch),
      canType: () => {
        const s = st.current;
        return !s.trip && !s.fixMode && s.sheet?.mode === 'type';
      },
      nag,
      mirror: () => st.current.prefs.trayMirror,
      setMirror: (on) => setPrefs({ trayMirror: on }),
    });
  }, [prefs.twMode, typeChars, nag, setPrefs, L?.id]);

  // 輸入框的落子無悔防護
  useEffect(() => {
    const ime = imeRef.current;
    if (!ime) return;
    return guardNoRegret(ime, {
      onText: (t) => typeChars(t),
      nag,
      tabAsSpace: true,
      onComposition: (t) => tw.current?.comp(t),
      onKey: (e, ph) => tw.current?.onKey(e, ph),
    });
  }, [typeChars, nag, L?.id]);

  // 紙上與整個書桌：右鍵、複製、剪下、拖放
  useEffect(() => {
    const pw = pwRef.current,
      stage = stageRef.current?.closest('section');
    if (!pw) return;
    const off1 = guardWritingArea(pw, nag);
    const copy = (e: Event) => {
      e.preventDefault();
      nag('複製已停用。');
    };
    stage?.addEventListener('copy', copy);
    stage?.addEventListener('cut', copy);
    return () => {
      off1();
      stage?.removeEventListener('copy', copy);
      stage?.removeEventListener('cut', copy);
    };
  }, [nag, L?.id]);

  // 建紙：信紙換了、紙種／樣式／字型／圖樣／書寫方式換了
  const structKey = view ? [view.id, view.kind, view.style, view.font, view.bg, view.scan, view.mode, L?.env.toName, L?.env.toAddr, L?.env.toEmail].join('|') : '';
  useLayoutEffect(() => {
    const pw = pwRef.current,
      ime = imeRef.current;
    if (!pw || !ime || !view || !L) return;
    const b = buildPaper(view, L.env);
    b.p.classList.toggle('hand', view.mode === 'hand');
    pw.replaceChildren(b.p, ime);
    paper.current = b;
    prevLen.current = { id: view.id, n: view.chars.length };
    bindPaper(b);
    const ro = new ResizeObserver(() => {
      const s = st.current.sheet;
      if (!s || !paper.current) return;
      drawInk(paper.current.cv, s);
      placeIme();
      drawX(paper.current.tl, s);
    });
    ro.observe(b.p);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey]);

  // 字：每次內容變了重排一次；新打的字加 .new（敲擊動畫）
  const marksN = sheet ? sheet.chars.reduce((a, c) => a + c.m.length, 0) : 0;
  useLayoutEffect(() => {
    const b = paper.current;
    if (!b || !view) return;
    const pv = prevLen.current;
    const newFrom = pv.id === view.id && view.chars.length > pv.n ? pv.n : Infinity;
    prevLen.current = { id: view.id, n: view.chars.length };
    renderType(b.tl, view, view.mode === 'type' && !fixMode && !trip, newFrom);
    setFixCursor(b);
    placeIme();
    tw.current?.eye(view.chars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, sheet?.chars.length, marksN, fixMode, fixTool, !!trip]);

  // 筆畫
  const strokesN = sheet?.strokes.length ?? 0;
  useLayoutEffect(() => {
    if (paper.current && view) drawInk(paper.current.cv, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, strokesN]);

  useEffect(() => {
    if (document.fonts?.ready)
      void document.fonts.ready.then(() => {
        const s = st.current.sheet;
        if (paper.current && s) drawX(paper.current.tl, s);
      });
  }, []);

  function setFixCursor(b: Paper) {
    const { fixMode: fm, fixTool: ft } = st.current;
    let cur = 'text';
    if (fm) {
      const svg =
        ft === 'tape'
          ? `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect x='6' y='4' width='22' height='16' rx='4' fill='%233A6EA5'/><rect x='1' y='14' width='12' height='5' fill='%23F6F6F1' stroke='%23888' stroke-width='1'/></svg>`
          : `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M4 28 L7 20 L24 3 L29 8 L12 25 Z' fill='%23E8B33A' stroke='%23333' stroke-width='1.2'/><path d='M4 28 L7 20 L12 25 Z' fill='%23F3DDB0' stroke='%23333' stroke-width='1.2'/><path d='M4 28 L5.5 24 L8 26.5Z' fill='%23333'/></svg>`;
      cur = `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}") ${ft === 'tape' ? '1 16' : '3 29'}, crosshair`;
    }
    b.tl.style.cursor = cur;
    b.tl.style.touchAction = fm ? 'none' : 'auto';
  }

  /** 紙上的指標：點紙叫出鍵盤、改錯拖過字、手寫 */
  function bindPaper({ p, tl, cv }: Paper) {
    p.addEventListener('pointerdown', (e) => {
      const s = st.current;
      if (s.trip || !s.sheet) return;
      if (s.sheet.mode === 'type' && !s.fixMode && s.kbd) {
        e.preventDefault();
        focusIme();
      }
    });
    // 手機與平板：有些瀏覽器只在 click 時才肯叫出鍵盤
    p.addEventListener('click', () => {
      const s = st.current;
      if (s.trip || !s.sheet) return;
      if (s.sheet.mode === 'type' && !s.fixMode && s.kbd && document.activeElement !== imeRef.current) focusIme();
    });
    // 改錯
    let a: number | null = null,
      b: number | null = null;
    const idx = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y) as HTMLElement | null;
      const c = t?.closest?.<HTMLElement>('.c');
      return c && tl.contains(c) ? +c.dataset.i! : null;
    };
    const hl = () => {
      $$('.c.sel', tl).forEach((s) => s.classList.remove('sel'));
      if (a == null || b == null) return;
      const [i, j] = a < b ? [a, b] : [b, a];
      for (let k = i; k <= j; k++) tl.querySelector(`.c[data-i="${k}"]`)?.classList.add('sel');
    };
    tl.addEventListener('pointerdown', (e) => {
      if (!st.current.fixMode || st.current.trip) return;
      const i = idx(e.clientX, e.clientY);
      if (i == null) return;
      e.preventDefault();
      a = b = i;
      tl.setPointerCapture?.(e.pointerId);
      hl();
    });
    tl.addEventListener('pointermove', (e) => {
      if (a == null) return;
      const i = idx(e.clientX, e.clientY);
      if (i != null && i !== b) {
        b = i;
        hl();
      }
    });
    tl.addEventListener('pointerup', () => {
      if (a == null || b == null) return;
      const s = st.current.sheet;
      const [i, j] = a < b ? [a, b] : [b, a];
      a = b = null;
      hl();
      if (!s || !writer.current) return;
      let any = false;
      for (let k = i; k <= j; k++) if (s.chars[k] && s.chars[k]!.c !== '\n') any = true;
      if (any) writer.current.push({ kind: 'mark', from: i, to: j, tool: st.current.fixTool });
    });
    tl.addEventListener('pointercancel', () => {
      a = b = null;
      hl();
    });
    // 手寫
    let stroke: Stroke | null = null,
      ctx: CanvasRenderingContext2D | null = null;
    cv.addEventListener('pointerdown', (e) => {
      const s = st.current;
      if (s.sheet?.mode !== 'hand' || s.trip) return;
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      const r = cv.getBoundingClientRect(),
        w = r.width;
      stroke = { pen: s.prefs.pen.pen, color: s.prefs.pen.color, pts: [[(e.clientX - r.left) / w, (e.clientY - r.top) / w, e.pressure || 0.5]] };
      ctx = cv.getContext('2d');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!stroke || !ctx) return;
      const r = cv.getBoundingClientRect(),
        w = r.width;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) stroke.pts.push([(ev.clientX - r.left) / w, (ev.clientY - r.top) / w, ev.pressure || 0.5]);
      strokeDraw(ctx, { ...stroke, pts: stroke.pts.slice(-evs.length - 1) }, w);
    });
    const fin = () => {
      if (!stroke || !writer.current) return;
      const pts = clampStrokePts(stroke.pts.map((q) => q.map((v) => Math.round(v * 10000) / 10000) as [number, number, number]));
      // 一筆最多 5000 點，太長就拆成好幾筆
      for (let i = 0; i < pts.length; i += 4999) writer.current.push({ kind: 'stroke', stroke: { ...stroke, pts: pts.slice(Math.max(0, i - 1), i + 4999) } });
      stroke = null;
    };
    cv.addEventListener('pointerup', fin);
    cv.addEventListener('pointercancel', fin);
  }

  /* ---------- 動作 ---------- */
  const upload = async (files: FileList | null, purpose: 'attachment' | 'bg' | 'front', max: number) => {
    if (!L || !files?.length) return [];
    const out = [];
    for (const f of files) {
      try {
        const c = await readImg(f, max);
        out.push(await api.upload(L.id, await toJpeg(c), purpose, f.name.replace(/\.\w+$/, '') + '.jpg'));
      } catch (e) {
        toast((e as Error).message);
      }
    }
    return out;
  };

  const doTranscribe = async () => {
    if (!L || !writer.current) return;
    closeModal();
    const old = paper.current?.p;
    let gw: HTMLDivElement | null = null,
      r: DOMRect | null = null;
    if (old && !RM) {
      r = old.getBoundingClientRect();
      gw = el('div', 'pw');
      gw.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;max-width:none;margin:0;z-index:60;transform-origin:0 0;pointer-events:none`;
      const ghost = old.cloneNode(true) as HTMLElement;
      gw.append(ghost);
      try {
        ghost.querySelector('canvas')?.getContext('2d')?.drawImage(old.querySelector('canvas')!, 0, 0);
      } catch {
        /* 略過 */
      }
      document.body.append(gw);
    }
    try {
      await writer.current.flush();
      const nl = await api.transcribe(L.id);
      setFixMode(false);
      setLetter(nl);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!gw || !r) return;
          const thumbs = $$('.refs .ref .thumb'),
            tgt = thumbs[thumbs.length - 1];
          if (tgt) tgt.style.opacity = '0';
          const tr = (tgt || document.querySelector('#refsList'))!.getBoundingClientRect(),
            dx = tr.left - r.left,
            dy = tr.top - r.top,
            s = Math.max(0.15, tr.width / r.width);
          const g = gw;
          void anim(
            g,
            [{ transform: 'none' }, { transform: `translate(6px,-14px) rotate(1.2deg)`, offset: 0.2 }, { transform: `translate(${dx}px,${dy}px) scale(${s}) rotate(${(2 + jit(1.5)).toFixed(1)}deg)`, opacity: 0.95 }],
            { d: 1250, e: INOUT },
          ).then(async () => {
            if (tgt) void anim(tgt, [{ opacity: 0 }, { opacity: 1 }], { d: 300 });
            await anim(g, [{ opacity: 0.95 }, { opacity: 0 }], { d: 300 });
            g.remove();
          });
          if (paper.current)
            void anim(
              paper.current.p,
              [{ opacity: 0, transform: 'translateY(-46px) rotate(-1.4deg)' }, { opacity: 1, transform: 'translateY(3px) rotate(.2deg)', offset: 0.8 }, { opacity: 1, transform: 'none' }],
              { d: 1000, delay: 450 },
            );
        }),
      );
      toast('舊的那張移到桌邊了。');
    } catch (e) {
      gw?.remove();
      toast((e as Error).message);
    }
  };

  const onCopy = () => {
    if (!sheet) return;
    const w = sheet.mode === 'hand' ? '謄抄' : '謄打';
    if (!hasContent(sheet)) {
      toast('這張還是空的，不用' + w + '。');
      return;
    }
    openModal({
      content: (
        <Confirm
          title={`${w}一份新的？`}
          body="目前這張會移到桌邊當參考，新的信紙從空白開始，用同樣的紙和筆。新的那張一樣沒有復原、沒有刪除、沒有橡皮擦。"
          cancel="先不要"
          ok="拿一張新的"
          onOk={doTranscribe}
        />
      ),
    });
  };

  const onShelve = () => {
    if (!L) return;
    if (!letterHas({ ...L, sheet: sheet ?? L.sheet })) {
      toast('書桌上還沒有信。');
      return;
    }
    openModal({
      content: (
        <Confirm
          title="先放著，不寄？"
          body="這封信會原封不動放進字紙冢旁邊的抽屜，不算廢紙。每過 30 天，會問你一次要不要寄出。"
          cancel="繼續寫"
          ok="放進抽屜"
          onOk={async () => {
            try {
              await writer.current?.flush();
              await api.shelve(L.id);
              const nl = await api.createLetter(eraDefaults(prefs.era));
              closeModal();
              attach(nl);
              void app.refreshCounts();
              toast('放進抽屜了。30 天後會問你一次。');
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
      ),
    });
  };

  const takeOut = async (u: LetterDTO) => {
    if (!L) return;
    if (trip) {
      toast('你正在去郵局的路上，回來再拿。');
      return;
    }
    try {
      await writer.current?.flush();
      if (letterHas({ ...L, sheet: sheet ?? L.sheet })) await api.shelve(L.id);
      const back = await api.unshelve(u.id);
      attach(back);
      setUnsent((x) => x.filter((y) => y.id !== u.id));
      void app.refreshCounts();
      toast('信拿出來放回書桌上了。');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const openRef = (refId: string) => {
    if (!L) return;
    const sh = L.refs.find((x) => x.id === refId);
    if (!sh) return;
    const vs = ownSheet(L, sh);
    openModal({
      content: (
        <RefModal
          sheet={vs}
          env={L.env}
          onTrash={async (state) => {
            try {
              const nl = await api.discardRef(L.id, sh.id, state, 'trash');
              closeModal();
              setLetter(nl);
              await trashScene(vs, state, L.env, prefs.era);
            } catch (e) {
              toast((e as Error).message);
              closeModal();
            }
          }}
          onTomb={async (state) => {
            try {
              const nl = await api.discardRef(L.id, sh.id, state, 'tomb');
              // 動畫跑完再關（RefModal 會同時等動畫）
              setTimeout(() => {
                closeModal();
                setLetter(nl);
                void app.refreshCounts();
                toast('送去字紙冢了。');
              }, RM ? 0 : 1950);
              return true;
            } catch (e) {
              toast((e as Error).message);
              return false;
            }
          }}
        />
      ),
    });
  };

  const onScanFile = async (f: File | undefined) => {
    if (!f || !L || !sheet) return;
    if (hasContent(sheet)) {
      toast('這張已經落筆了。先謄一張新的，再匯入紙本。');
      return;
    }
    let img: HTMLCanvasElement;
    try {
      img = await readImg(f, 4000);
    } catch (e) {
      toast((e as Error).message);
      return;
    }
    openModal({
      content: (
        <ScanEditor
          img={img}
          onOk={async (o) => {
            try {
              const att = await api.upload(L.id, await toJpeg(o, 0.85), 'scan', 'scan.jpg');
              await api.patchSheet(L.id, { style: 'plain', mode: 'hand' });
              await api.scan(L.id, att.id);
              closeModal();
              const fresh = await api.getLetter(L.id);
              setL(fresh);
              writer.current?.reset(fresh.sheet);
              toast('紙本放上來了。可以接著在上面寫，或劃掉。');
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
      ),
    });
  };

  const onFontFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const name = 'U' + uid();
      const ff = new FontFace(name, await f.arrayBuffer());
      await ff.load();
      document.fonts.add(ff);
      FONTS[name] = { label: '自訂：' + f.name.replace(/\.\w+$/, ''), css: `'${name}','Noto Serif TC',serif` };
      await patchSheet({ font: name });
      toast('字型已載入。字型還沒存到伺服器，重新整理後要再上傳一次。');
    } catch {
      toast('這個檔案讀不成字型。請用 ttf、otf、woff 或 woff2。');
    }
  };

  const setTwMode = (v: TwMode) => {
    setPrefs({ twMode: v });
    if (sheet && !hasContent(sheet)) {
      if (v === 'cn') void patchSheet({ font: 'song' });
      else if (v === 'tw') void patchSheet({ font: 'lead' });
    }
    toast(v === 'keys' ? '用鍵盤打字。' : v === 'tw' ? '換成台灣的中文打字機：繁體字盤，照部首找字。' : '換成中國的中文打字機：簡體字盤，常一起用的字擺在一塊。');
  };

  /* ---------- 畫面 ---------- */
  if (loadErr)
    return (
      <div className="empty">
        <h2 className="h2">書桌打不開</h2>
        <p>{loadErr}</p>
        <button type="button" className="btn" onClick={() => void reload()}>
          再試一次
        </button>
      </div>
    );
  if (!L || !sheet || !view) return <p className="hint">把信紙拿出來…</p>;

  const now = app.now();
  const due = unsent.find((u) => u.askDue);
  const front = L.frontAttachmentId ? attachmentUrl(L.frontAttachmentId) : null;
  const styleVal = sheet.kind === 'postcard' && (sheet.style === 'grid' || sheet.style === 'bahang') ? 'lined' : sheet.style;
  const sum = toolsOpen
    ? ''
    : [sheet.kind === 'postcard' ? '明信片' : '信紙', STYLE_OPTS.find(([v]) => v === styleVal)?.[1], sheet.mode === 'hand' ? PENS[prefs.pen.pen]!.label : (FONTS[sheet.font] || FONTS.typewriter!).label]
        .filter(Boolean)
        .join('・');

  return (
    <>
      {due && (
        <div id="banner" className="banner">
          <div className="alert">
            <p>
              {fmt(due.shelvedAt ?? due.createdAt, { time: false })} 寫給 <b>{due.env.toName || '某個人'}</b> 的那封信，已經放了 {Math.floor((now - (due.shelvedAt ?? now)) / D)} 天。現在想寄出了嗎？
            </p>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn small"
                id="bLater"
                onClick={async () => {
                  try {
                    const u = await api.askLater(due.id);
                    setUnsent((x) => x.map((y) => (y.id === u.id ? u : y)));
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                再放 30 天
              </button>
              <button type="button" className="btn small primary" id="bTake" onClick={() => void takeOut(due)}>
                拿出來
              </button>
            </span>
          </div>
        </div>
      )}
      <div className="desk">
        <aside className={'panel tools' + (toolsOpen ? '' : ' collapsed')} aria-label="紙筆">
          <button type="button" className="tools-toggle" id="toolsToggle" aria-expanded={toolsOpen} onClick={() => setToolsOpen((o) => !o)}>
            <span>紙筆設定</span>
            <span className="sum" id="toolsSum">
              {sum}
            </span>
            <svg className="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="tgroup">
            <span className="label">書桌</span>
            <div className="seg" id="deskSeg">
              {(Object.keys(DESKS) as DeskKind[]).map((k) => (
                <button key={k} type="button" data-v={k} aria-pressed={prefs.desk === k} onClick={() => setPrefs({ desk: k })}>
                  {k === 'wood' ? '木桌・綠檯燈' : k === 'white' ? '白桌・燈帶' : '課桌'}
                </button>
              ))}
            </div>
          </div>
          <div className="tgroup">
            <span className="label">用紙</span>
            <div className="seg" id="kindSeg">
              {(
                [
                  ['letter', '信紙'],
                  ['postcard', '明信片'],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  data-v={v}
                  aria-pressed={sheet.kind === v}
                  disabled={locked || !!trip}
                  onClick={() => void patchSheet(v === 'postcard' && (sheet.style === 'grid' || sheet.style === 'bahang') ? { kind: v, style: 'lined' } : { kind: v })}
                >
                  {l}
                </button>
              ))}
            </div>
            <select id="styleSel" aria-label="信紙樣式" value={styleVal} disabled={locked || !!trip} onChange={(e) => void patchSheet({ style: e.target.value as SheetDTO['style'] })}>
              {STYLE_OPTS.map(([v, l]) => (
                <option key={v} value={v} disabled={(sheet.kind === 'postcard' && (v === 'grid' || v === 'bahang')) || (v === 'custom' && !sheet.bgAttachmentId)}>
                  {l}
                </option>
              ))}
            </select>
            <label className={'btn small' + (locked ? ' dis' : '')} id="bgBtn">
              上傳信紙圖樣
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={locked || !!trip}
                onChange={async (e) => {
                  const fs = e.target.files;
                  const [a] = await upload(fs, 'bg', 1400);
                  e.target.value = '';
                  if (a) await patchSheet({ bgAttachmentId: a.id, style: 'custom' });
                }}
              />
            </label>
            {sheet.kind === 'postcard' && (
              <div id="frontBox" className="tgroup" style={{ width: '100%' }}>
                <span className="label">明信片正面</span>
                <div
                  className="front"
                  id="frontPreview"
                  style={{ backgroundImage: front ? `url(${front})` : undefined, cursor: 'pointer' }}
                  onClick={() => {
                    if (!front) {
                      toast('還沒有正面圖片。');
                      return;
                    }
                    openModal({ content: <FlipCard front={front} sheet={view} env={L.env} /> });
                  }}
                >
                  {front ? '' : '還沒有圖片'}
                </div>
                <label className="btn small">
                  上傳正面圖片
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={!!trip}
                    onChange={async (e) => {
                      const [a] = await upload(e.target.files, 'front', 1400);
                      e.target.value = '';
                      if (a) {
                        try {
                          setL(await api.patchLetter(L.id, { frontAttachmentId: a.id }));
                        } catch (err) {
                          toast((err as Error).message);
                        }
                      }
                    }}
                  />
                </label>
              </div>
            )}
            <p className="hint" id="paperLock" hidden={!locked}>
              已經落筆，這張紙換不了。想換紙，就謄一份新的。
            </p>
          </div>
          <div className="tgroup">
            <span className="label">書寫方式</span>
            <div className="seg" id="modeSeg">
              {(
                [
                  ['type', '打字機'],
                  ['hand', '手寫'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" data-v={v} aria-pressed={sheet.mode === v} disabled={!!trip} onClick={() => void patchSheet({ mode: v })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="tgroup" id="typeOpts" hidden={sheet.mode !== 'type'}>
            <span className="label">打字機</span>
            <div className="seg" id="twModeSeg">
              {(
                [
                  ['keys', '鍵盤輸入'],
                  ['tw', '台灣字盤'],
                  ['cn', '中國字盤'],
                ] as [TwMode, string][]
              ).map(([v, l]) => (
                <button key={v} type="button" data-v={v} aria-pressed={prefs.twMode === v} onClick={() => setTwMode(v)}>
                  {l}
                </button>
              ))}
            </div>
            <span className="label">字型</span>
            <select id="fontSel" aria-label="字型" value={FONTS[sheet.font] ? sheet.font : 'typewriter'} disabled={!!trip} onChange={(e) => void patchSheet({ font: e.target.value })}>
              {Object.entries(FONTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <label className="btn small">
              上傳字型
              <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => (void onFontFile(e.target.files?.[0]), (e.target.value = ''))} />
            </label>
          </div>
          <div className="tgroup" id="handOpts" hidden={sheet.mode !== 'hand'}>
            <span className="label">筆</span>
            <div className="seg" id="penSeg">
              {Object.entries(PENS).map(([k, v]) => (
                <button key={k} type="button" data-v={k} aria-pressed={prefs.pen.pen === k} onClick={() => setPrefs({ pen: { ...prefs.pen, pen: k as 'fountain' } })}>
                  {v.label}
                </button>
              ))}
            </div>
            <div className="swatches" id="inkSw">
              {INKS.map(([c, n]) => (
                <button key={c} type="button" style={{ background: c }} data-c={c} aria-label={n} title={n} aria-pressed={prefs.pen.color === c} onClick={() => setPrefs({ pen: { ...prefs.pen, color: c } })} />
              ))}
            </div>
            <label className={'btn small' + (locked ? ' dis' : '')} id="scanBtn">
              匯入紙本（照片或掃描）
              <input type="file" accept="image/*" hidden disabled={!!trip} onChange={(e) => (void onScanFile(e.target.files?.[0]), (e.target.value = ''))} />
            </label>
            <p className="hint">手寫時想改，直接在紙上劃掉。</p>
          </div>
          <div className="tgroup">
            <span className="label">附件</span>
            <label className="btn small">
              夾一張照片
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={!!trip}
                onChange={async (e) => {
                  const got = await upload(e.target.files, 'attachment', 1000);
                  e.target.value = '';
                  if (got.length) setL(await api.getLetter(L.id));
                }}
              />
            </label>
            <p className="hint">附件跟信紙放在一起，不會被折疊起來。</p>
          </div>
        </aside>

        <div className="stage" ref={stageRef}>
          <DeskDeco desk={prefs.desk} />
          <div className="desk-lock" id="deskLock" hidden={!trip}>
            <div>
              <b className="h2">信在你身上</b>
              <p className="hint">你正帶著它去郵局。到郵局前，信是封好的。</p>
              <button type="button" className="btn primary" onClick={() => nav('/post')}>
                看路程
              </button>
            </div>
          </div>
          <div className="actbar">
            <button
              type="button"
              className="btn"
              id="btnFix"
              aria-pressed={fixMode}
              hidden={sheet.mode !== 'type'}
              onClick={() => {
                const on = !fixMode;
                setFixMode(on);
                if (on) toast('拖過要改的字。痕跡會一直留著。');
              }}
            >
              {fixMode ? '改完了' : '改錯'}
            </button>
            <button type="button" className="btn" id="btnCopy" onClick={onCopy}>
              {sheet.mode === 'hand' ? '謄抄' : '謄打'}
            </button>
            <span className="sp"></span>
            <button type="button" className="btn ghost" id="btnShelve" onClick={onShelve}>
              先放著，不寄
            </button>
            <button type="button" className="btn primary" id="btnEnv" onClick={() => nav('/post')}>
              裝進信封 →
            </button>
          </div>
          <div className="fixbar" id="fixBar" hidden={!fixMode}>
            <span className="label" style={{ marginRight: 4 }}>
              鉛筆
            </span>
            {FIX_TOOLS.map((f) => (
              <button key={f.t} type="button" className="tool" data-t={f.t} aria-pressed={fixTool === f.t} onClick={() => setFixTool(f.t)}>
                <i style={f.style}>{f.ch}</i>
                {f.label}
              </button>
            ))}
            <span className="label" style={{ margin: '0 4px 0 8px' }}>
              修正帶
            </span>
            <button type="button" className="tool" data-t="tape" aria-pressed={fixTool === 'tape'} onClick={() => setFixTool('tape')}>
              <i style={{ background: '#F6F6F1', color: '#F6F6F1', boxShadow: '0 0 0 1px #ccc' }}>字</i>修正帶
            </button>
            <span className="hint" style={{ marginLeft: 'auto' }}>
              在字上拖過去。痕跡會一直留著。
            </span>
          </div>
          <div className="pw" id="pw" ref={pwRef}>
            <textarea
              ref={imeRef}
              id="ime"
              className="ime"
              aria-label="打字輸入"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              readOnly={!!trip}
            />
          </div>
          <div className={'tw' + (fixMode ? ' dim' : '')} id="tw" ref={twRef} hidden={sheet.mode !== 'type' || !kbd} />
          <div className={'tray' + (fixMode ? ' dim' : '')} id="tray" ref={trayRef} hidden={sheet.mode !== 'type' || kbd} />
          <p className="rule-note">
            落子無悔：沒有復原、沒有刪除、沒有橡皮擦，複製與貼上已停用。
            {saveStatus === 'saving' && <span className="save-st"> 收進抽屜裡…</span>}
            {saveStatus === 'retrying' && <span className="save-st warn-text"> 連不上伺服器，字還在桌上，等一下自動再送。</span>}
          </p>
          <div className="atts" id="atts">
            {L.attachments.map((a) => (
              <div
                key={a.id}
                className="att"
                style={{ ['--r' as string]: (hash(a.id) % 9) - 4 + 'deg' }}
                onClick={() => openModal({ content: <ImageModal src={attachmentUrl(a.id)} /> })}
              >
                <span className="clip"></span>
                <img alt="附件照片" src={attachmentUrl(a.id)} />
                <button
                  type="button"
                  className="out"
                  data-out={a.id}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (trip) return;
                    try {
                      setL(await api.takeOut(L.id, a.id));
                    } catch (err) {
                      toast((err as Error).message);
                    }
                  }}
                >
                  拿出來
                </button>
              </div>
            ))}
          </div>
        </div>

        <aside className="panel refs" aria-label="桌邊的舊信紙">
          <span className="label">桌邊的舊信紙</span>
          <div id="refsList" className="refs">
            {!L.refs.length ? (
              <p className="hint">目前沒有。</p>
            ) : (
              L.refs.map((sh, i) => (
                <div key={sh.id} className="ref">
                  <SheetThumb sheet={ownSheet(L, sh)} width={186} env={L.env} className="click" onClick={() => openRef(sh.id)} />
                  <div className="row">
                    <span className="hint">
                      第 {i + 1} 版・{fmt(sh.createdAt, { wk: false })}
                    </span>
                  </div>
                  <div className="row">
                    <button type="button" className="btn small" data-ref={sh.id} onClick={() => openRef(sh.id)}>
                      處理這張
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="hint">謄一份新的之後，舊的那張移到這裡當參考。寄出前，要決定它進字紙冢還是垃圾桶。</p>
        </aside>
      </div>
    </>
  );
}

function DeskDeco({ desk }: { desk: DeskKind }) {
  if (desk === 'white') return <span className="desk-deco deco-strip" aria-hidden="true"></span>;
  if (desk === 'school')
    return (
      <>
        <span className="desk-deco deco-groove" aria-hidden="true"></span>
        <span className="desk-deco deco-scratch" aria-hidden="true">
          期末考加油
        </span>
      </>
    );
  return (
    <Html
      as="span"
      className="desk-deco-wrap"
      style={{ display: 'contents' }}
      html={`<svg class="desk-deco deco-lamp" viewBox="0 0 120 120" aria-hidden="true"><ellipse cx="60" cy="114" rx="34" ry="5" fill="rgba(0,0,0,.4)"/><rect x="44" y="102" width="32" height="10" rx="3" fill="#B8913E"/><rect x="57" y="52" width="6" height="52" fill="#C9A24A"/><path d="M12 54 Q60 14 108 54Z" fill="#1E6A3E" stroke="#0E3E22" stroke-width="2"/><path d="M22 48 Q60 24 98 48" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"/><rect x="10" y="52" width="100" height="6" rx="3" fill="#C9A24A"/><path d="M76 104 v-14" stroke="#C9A24A" stroke-width="2"/><circle cx="76" cy="88" r="3" fill="#8A6A2E"/></svg>`}
    />
  );
}

export { isApiError };
