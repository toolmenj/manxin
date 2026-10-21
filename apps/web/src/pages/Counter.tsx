/**
 * 郵局櫃台：選信封／郵票／郵戳與上傳、確認地址、信封上寫字、徒手摺信、裝信（裝不下看 TOO_WIDE／TOO_LONG）、
 * 封口、拖曳貼郵票與蓋郵戳、拖進郵筒。每個動作都先送到後端，伺服器說了算；動畫只是表現。
 */
import type { CounterDTO, EnvAddress, EnvelopeKind, FoldEdge, LetterDTO, PostmarkId, StampId, Stroke, TripDTO } from '@manxin/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, attachmentUrl, isApiError } from '../api/client.ts';
import { Confirm } from '../components/DeskModals.tsx';
import { ENVS, envBackHTML, envFrontHTML, paintZones, PMS, rubberSVG, STAMPS, stampArt, zDraw, type ViewPkg } from '../lib/art.ts';
import { dragPiece } from '../lib/drag.ts';
import { readImg, toJpeg } from '../lib/image.ts';
import { ownSheet } from '../lib/letters.ts';
import { abortScenes, anim, INOUT, wait } from '../lib/motion.ts';
import { ENVELOPE_MESSAGES, guardNoRegret } from '../lib/noRegret.ts';
import { loadFont, mountSheet } from '../lib/paper.ts';
import { postboxHTML, slideIntoSlot } from '../lib/postbox.ts';
import { postScene } from '../lib/scenes.ts';
import { $, $$, el, jit, okMail } from '../lib/util.ts';
import { useApp } from '../state/app.tsx';
import { clack } from '../lib/typewriter.ts';

/** 摺信：手指（滑鼠）落在紙外這麼多 px 之內，也算抓到紙邊 */
export const FOLD_REACH = 12;

interface FoldGeo {
  pkEl: HTMLElement;
  face: HTMLElement;
  sc: number;
  /** 信紙中心在外框（#ctFold）裡的位置 */
  cx: number;
  cy: number;
}

const MISSING_LABEL: Record<string, string> = { ADDRESS: '確認地址', INSERT: '把信放進信封', SEAL: '封口', STAMP: '貼郵票' };

export function counterPkg(c: CounterDTO): ViewPkg {
  return {
    env: c.env,
    stamp: c.stamp,
    stampSrc: c.stampAttachmentId ? attachmentUrl(c.stampAttachmentId) : null,
    pm: c.pm,
    pmSrc: c.pmAttachmentId ? attachmentUrl(c.pmAttachmentId) : null,
    skin: c.skinAttachmentId ? attachmentUrl(c.skinAttachmentId) : null,
    stampPos: c.stampPos,
    pmPos: c.pmPos,
    pmAt: c.pmAt,
    etxt: c.etxt,
    folds: c.folds,
    pack: c.pack,
    rot: c.rot,
  };
}

const ADDR_FIELDS: [keyof EnvAddress, string, string][] = [
  ['fromName', '名字（選填）', 'text'],
  ['fromEmail', '電子信箱（提醒和退信會寄到這裡）', 'email'],
  ['fromAddr', '實體地址（選填，大概就好）', 'text'],
  ['toName', '名字（選填）', 'text'],
  ['toEmail', '電子信箱', 'email'],
  ['toAddr', '實體地址（選填，大概就好）', 'text'],
];

export function Counter({ letter, trip, onLetter, reload }: { letter: LetterDTO; trip: TripDTO; onLetter: (l: LetterDTO) => void; reload: () => Promise<void> }) {
  const app = useApp();
  const nav = useNavigate();
  const { toast, nag, openModal, closeModal, prefs } = app;
  const L = letter;
  const [c, setC] = useState<CounterDTO | null>(null);
  const [env, setEnv] = useState<EnvAddress>(L.env);
  const [zone, setZone] = useState<'from' | 'to' | null>(null);
  const envRef = useRef<HTMLDivElement>(null);
  const foldRef = useRef<HTMLDivElement>(null);
  const eimeRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cRef = useRef(c);
  cRef.current = c;
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const envSave = useRef<{ t: ReturnType<typeof setTimeout> | null; p: Promise<unknown> }>({ t: null, p: Promise.resolve() });
  /** 還在櫃台（換頁後寄出的過場要收掉，也不再自動跳到追蹤頁） */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortScenes();
    };
  }, []);

  const id = L.id;
  const pc = c?.env === 'card';

  useEffect(() => {
    api
      .counter(id)
      .then(setC)
      .catch((e) => {
        toast((e as Error).message);
        void reload();
      });
  }, [id, toast, reload, app.timeVersion]);

  /** 依序送出（信封上的字要照順序） */
  const run = useCallback(
    <T,>(f: () => Promise<T>): Promise<T | undefined> => {
      const p = queue.current.then(f).catch((e) => {
        toast((e as Error).message);
        return undefined;
      });
      queue.current = p;
      return p as Promise<T | undefined>;
    },
    [toast],
  );

  /* ---------- 信封正面 ---------- */
  // D-028：信封上的字跟信紙同一個字型（自訂字型用 sheet.fontUrl 載入）
  const efont = loadFont(L.sheet.font, L.sheet.fontUrl);
  const pk = c ? { ...counterPkg(c), efont } : null;
  const pkKey = c ? JSON.stringify([c, zone, prefs.era, efont]) : '';
  useLayoutEffect(() => {
    const ce = envRef.current;
    if (!ce || !c || !pk) return;
    ce.innerHTML = envFrontHTML(pk, { live: true, active: zone, office: trip.placeName, t: app.now() });
    if (c.env === 'card') {
      const card = $('.ev-card', ce);
      if (card) mountSheet(card, ownSheet(L), ce.clientWidth, {});
    }
    paintZones(ce, pk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkKey]);

  useEffect(() => {
    if (zone && c?.emode === 'type') setTimeout(() => eimeRef.current?.focus({ preventScroll: true }), 50);
  }, [zone, c?.emode]);

  /* 信封上打字：跟信紙一樣不能擦 */
  useEffect(() => {
    const t = eimeRef.current;
    if (!t) return;
    return guardNoRegret(t, {
      messages: ENVELOPE_MESSAGES,
      nag,
      onText: (v) => {
        const cc = cRef.current,
          z = zoneRef.current;
        if (!cc || !z || cc.emode !== 'type' || !v) return;
        // 先畫上去，再送出
        const local = { ...cc, etxt: { ...cc.etxt, [z]: { ...cc.etxt[z], c: [...cc.etxt[z].c, ...v] } } };
        setC(local);
        clack(prefs.sound !== false);
        void run(() => api.envelopeText(id, z, v.slice(0, 200))).then((r) => r && setC(r));
      },
    });
    // 櫃台資料到了，輸入框才掛上去
  }, [id, nag, run, prefs.sound, c ? 1 : 0]);

  const onEnvPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const cc = cRef.current;
    if (!cc) return;
    const z = (e.target as HTMLElement).closest<HTMLElement>('.ez');
    if (z && zone && z.dataset.z === zone) {
      e.preventDefault();
      e.stopPropagation();
      if (cc.emode === 'type') {
        eimeRef.current?.focus({ preventScroll: true });
        return;
      }
      handStroke(z, e.nativeEvent);
      return;
    }
    if (zone || e.button > 0) return;
    if (cc.missing.length) {
      toast('還不能寄：' + cc.missing.map((m) => MISSING_LABEL[m]).join('、') + '。');
      return;
    }
    dragEnvelope(e);
  };

  const handStroke = (z: HTMLElement, e: PointerEvent) => {
    const k = z.dataset.z as 'from' | 'to';
    const cv = $<HTMLCanvasElement>('.ez-c', z),
      r = z.getBoundingClientRect(),
      w = r.width,
      ctx = cv?.getContext('2d');
    z.setPointerCapture?.(e.pointerId);
    const s: Stroke = { pen: prefs.pen.pen, color: prefs.pen.color, pts: [[(e.clientX - r.left) / w, (e.clientY - r.top) / w, e.pressure || 0.5]] };
    const mv = (ev: PointerEvent) => {
      s.pts.push([(ev.clientX - r.left) / w, (ev.clientY - r.top) / w, ev.pressure || 0.5]);
      if (ctx) zDraw(ctx, { ...s, pts: s.pts.slice(-2) }, w);
    };
    const upf = () => {
      z.removeEventListener('pointermove', mv);
      z.removeEventListener('pointerup', upf);
      s.pts = s.pts.slice(0, 5000).map((q) => q.map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number]);
      const cc = cRef.current;
      if (cc) setC({ ...cc, etxt: { ...cc.etxt, [k]: { ...cc.etxt[k], s: [...cc.etxt[k].s, s] } } });
      void run(() => api.envelopeStroke(id, k, s)).then((r2) => r2 && setC(r2));
    };
    z.addEventListener('pointermove', mv);
    z.addEventListener('pointerup', upf);
  };

  /* ---------- 拖進郵筒 ---------- */
  const dragEnvelope = (e: React.PointerEvent<HTMLDivElement>) => {
    const ev = envRef.current!;
    dragPiece(
      ev,
      e,
      ev.innerHTML,
      async (cx, cy, g) => {
        const pbx = $('#ctBox .pbx'),
          slit = $('#ctBox .slit');
        if (!pbx || !slit) return false;
        const b = slit.getBoundingClientRect();
        if (cx < b.left - 50 || cx > b.right + 50 || cy < b.top - 80 || cy > b.bottom + 80) return false;
        // 先送出，動畫同時播（動畫只是表現，不等它）
        const posting = api.postLetter(id).then(
          (s) => ({ ok: true as const, s }),
          (err: unknown) => ({ ok: false as const, err }),
        );
        // 對準投信口 → 滑進去 → 郵筒晃一下
        const back = await slideIntoSlot(g, pbx, prefs.era);
        const r = await posting;
        if (!r.ok) {
          // 寄不出去：信從投信口抽回來，回到桌上
          await back();
          const er = r.err;
          toast(isApiError(er) ? er.message : '寄不出去，請再試一次。');
          return false;
        }
        void app.refreshCounts();
        if (!alive.current) return true;
        // 郵差來收信 → 單號（可略過）
        await postScene({ no: r.s.no, box: trip.box, era: prefs.era });
        if (alive.current) nav('/track/' + r.s.no);
        return true;
      },
      (g) => {
        if (cRef.current && $('.ez', g)) paintZones(g, counterPkg(cRef.current));
      },
    );
  };

  /* ---------- 郵票、郵戳 ---------- */
  const dragStamp = (e: React.PointerEvent<HTMLDivElement>) => {
    const cc = cRef.current;
    if (!cc) return;
    const p = counterPkg(cc);
    dragPiece(e.currentTarget, e, stampArt(p.stamp, p.stampSrc), async (cx, cy) => {
      const b = $('#ctEnv .envf')!.getBoundingClientRect();
      if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return false;
      try {
        const n = await api.stamp(id, { x: (cx - b.left) / b.width, y: (cy - b.top) / b.height, r: +jit(6).toFixed(1) });
        setC(n);
        requestAnimationFrame(() => {
          const s = $('#ctEnv .ev-stamp');
          if (s) void anim(s, [{ scale: '1.12' }, { scale: '.97', offset: 0.6 }, { scale: '1' }], { d: 380 });
        });
        return true;
      } catch (err) {
        toast((err as Error).message);
        return false;
      }
    });
  };

  const dragPm = (e: React.PointerEvent<HTMLDivElement>) => {
    dragPiece(e.currentTarget, e, rubberSVG(), async (cx, _cy, g) => {
      const b = $('#ctEnv .envf')!.getBoundingClientRect(),
        gr = g.getBoundingClientRect(),
        py = gr.bottom - 6;
      if (cx < b.left || cx > b.right || py < b.top || py > b.bottom) return false;
      const req = api.postmark(id, { x: (cx - b.left) / b.width, y: (py - b.top) / b.height, r: +jit(14).toFixed(1) }).then(
        (n) => n,
        (err: unknown) => err as Error,
      );
      await anim(g, [{ translate: '0 0' }, { translate: '0 10px', scale: '.95' }, { translate: '0 -6px' }], { d: 420, e: 'ease-in-out' });
      const n = await req;
      if (n instanceof Error) {
        toast(n.message);
        return false;
      }
      setC(n);
      return true;
    });
  };

  /* ---------- 摺信：從邊緣往內拖，摺線落在邊緣和手指的正中間 ---------- */
  // 手勢綁在外框（#ctFold）上而不是信紙上：摺完一次信紙會換新的元素，外框不會，所以
  // - 上一摺還在送後端時按下去，先記住這一按，新的信紙一畫好就接著摺（不會「按了沒反應」）；
  // - 位置用外框量（信紙的中心固定在外框正中間），不受摺完那下 scale 1.04 → 1 的放大動畫影響。
  const foldKey = c ? JSON.stringify([c.pack, c.folds, c.rot, c.inserted]) : '';
  const foldGeo = useRef<FoldGeo | null>(null);
  const foldBusy = useRef(false);
  const foldBound = useRef<HTMLElement | null>(null);
  const foldResume = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const box = foldRef.current,
      cc = cRef.current;
    foldGeo.current = null;
    if (!box || !cc || cc.env === 'card' || !cc.pack) return;
    if (foldBound.current !== box) {
      foldBound.current = box;
      bindFold(box);
    }
    box.innerHTML = '';
    const info = $('#foldInfo');
    if (cc.inserted) {
      box.innerHTML = '<p class="hint" style="padding:12px">信已經在信封裡了。</p>';
      if (info) info.textContent = '';
      return;
    }
    const aw = box.clientWidth || 300,
      ah = box.clientHeight || 400,
      P = cc.pack,
      span = Math.max(P.x1 - P.x0, P.y1 - P.y0),
      sc = Math.min(240, aw * 0.62, (ah - 40) / Math.max(1, span)),
      w = (P.x1 - P.x0) * sc,
      h = (P.y1 - P.y0) * sc;
    const pkEl = el('div', 'pk');
    pkEl.style.cssText = `width:${w}px;height:${h}px;left:${aw / 2 - w / 2}px;top:${ah / 2 - h / 2}px;transform:rotate(${cc.rot ? 90 : 0}deg)`;
    // 可抓的範圍比紙大一圈（FOLD_REACH）：手指不用落在紙的內側，按在紙邊外一點點也抓得到
    const reach = el('i', 'pk-reach');
    reach.style.cssText = `position:absolute;inset:-${FOLD_REACH}px`;
    const face = el('div', 'pk-face');
    pkEl.append(reach, face);
    if (!cc.folds.length) {
      const th = el('div', 'pk-th');
      face.append(th);
      box.append(pkEl);
      mountSheet(th, ownSheet(L), sc, {});
    } else {
      cc.folds.forEach((f) => {
        if (f.a === 'h' && f.at > P.y0 + 0.005 && f.at < P.y1 - 0.005) face.insertAdjacentHTML('beforeend', `<i class="pk-cr h" style="top:${(f.at - P.y0) * sc}px"></i>`);
        if (f.a === 'v' && f.at > P.x0 + 0.005 && f.at < P.x1 - 0.005) face.insertAdjacentHTML('beforeend', `<i class="pk-cr v" style="left:${(f.at - P.x0) * sc}px"></i>`);
      });
      box.append(pkEl);
    }
    if (info) info.textContent = cc.folds.length ? `摺了 ${cc.folds.length} 次。` : '還沒摺。按住信紙的邊緣往內拖。';
    foldGeo.current = { pkEl, face, sc, cx: aw / 2, cy: ah / 2 };
    if (!foldBusy.current) foldResume.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldKey]);

  function bindFold(box: HTMLElement) {
    let stt: { edge: FoldEdge; q0: { x: number; y: number }; w: number; h: number; f: number | null; g: FoldGeo } | null = null,
      fl: HTMLElement | null = null,
      /** 上一摺還在送的時候按下去的那一下（紙換好再接著摺） */
      held: { id: number; x0: number; y0: number; x: number; y: number; up: boolean } | null = null;
    /** 以信紙中心為原點的座標（信紙轉 90° 時換回信紙自己的方向） */
    const local = (g: FoldGeo, x: number, y: number) => {
      const r = box.getBoundingClientRect(),
        u = x - (r.left + box.clientLeft + g.cx),
        v = y - (r.top + box.clientTop + g.cy);
      return cRef.current?.rot ? { x: v, y: -u } : { x: u, y: v };
    };
    const begin = (x: number, y: number): boolean => {
      const g = foldGeo.current,
        cc = cRef.current;
      if (!g || !cc?.pack) return false;
      if (cc.folds.length >= 6) {
        toast('太厚了，摺不動了。');
        return false;
      }
      const P = cc.pack,
        w = (P.x1 - P.x0) * g.sc,
        h = (P.y1 - P.y0) * g.sc,
        q = local(g, x, y);
      if (Math.abs(q.x) > w / 2 + FOLD_REACH || Math.abs(q.y) > h / 2 + FOLD_REACH) return false;
      const d = { l: q.x + w / 2, r: w / 2 - q.x, t: q.y + h / 2, b: h / 2 - q.y },
        edge = (Object.entries(d) as [FoldEdge, number][]).sort((a, b) => a[1] - b[1])[0]!;
      if (edge[1] > Math.max(30, Math.min(w, h) * 0.3)) return false;
      stt = { edge: edge[0], q0: q, w, h, f: null, g };
      fl = el('div', 'pk-flap');
      g.pkEl.append(fl);
      return true;
    };
    const move = (x: number, y: number) => {
      if (!stt || !fl) return;
      const { edge, w, h, g } = stt,
        q = local(g, x, y),
        face = g.face;
      if (edge === 'b' || edge === 't') {
        const ey = edge === 'b' ? h / 2 : -h / 2,
          f = Math.max(-h / 2 + 2, Math.min(h / 2 - 2, (ey + q.y) / 2)),
          len = Math.abs(ey - f);
        face.style.clipPath = edge === 'b' ? `inset(0 0 ${h / 2 - f}px 0)` : `inset(${f + h / 2}px 0 0 0)`;
        fl.style.cssText = `left:0;width:${w}px;height:${len}px;top:${edge === 'b' ? f + h / 2 - len : f + h / 2}px`;
        stt.f = f;
      } else {
        const ex = edge === 'r' ? w / 2 : -w / 2,
          f = Math.max(-w / 2 + 2, Math.min(w / 2 - 2, (ex + q.x) / 2)),
          len = Math.abs(ex - f);
        face.style.clipPath = edge === 'r' ? `inset(0 ${w / 2 - f}px 0 0)` : `inset(0 0 0 ${f + w / 2}px)`;
        fl.style.cssText = `top:0;height:${h}px;width:${len}px;left:${edge === 'r' ? f + w / 2 - len : f + w / 2}px`;
        stt.f = f;
      }
      fl.className = 'pk-flap ' + edge;
    };
    const drop = () => {
      if (stt) stt.g.face.style.clipPath = '';
      stt = null;
      fl?.remove();
      fl = null;
    };
    const end = async (x: number, y: number) => {
      if (!stt) return;
      const { edge, f, q0, g } = stt,
        q = local(g, x, y);
      drop();
      const cc = cRef.current;
      if (f == null || Math.hypot(q.x - q0.x, q.y - q0.y) < 10 || !cc?.pack) return;
      const P = cc.pack,
        F = f / g.sc;
      const at = edge === 'b' || edge === 't' ? (P.y0 + P.y1) / 2 + F : (P.x0 + P.x1) / 2 + F;
      foldBusy.current = true;
      try {
        const n = await api.fold(id, edge, at);
        foldBusy.current = false;
        setC(n);
        requestAnimationFrame(() => {
          const np = $('#ctFold .pk');
          if (np) void anim(np, [{ scale: '1.04' }, { scale: '1' }], { d: 320 });
        });
      } catch (err) {
        foldBusy.current = false;
        toast((err as Error).message);
        foldResume.current();
      }
    };
    foldResume.current = () => {
      if (!held || stt) return;
      const h = held;
      held = null;
      if (!begin(h.x0, h.y0)) return;
      move(h.x, h.y);
      if (h.up) void end(h.x, h.y);
    };
    box.addEventListener('pointerdown', (e) => {
      if (stt || !(e.target as Element | null)?.closest?.('.pk')) return;
      if (foldBusy.current) {
        e.preventDefault();
        box.setPointerCapture?.(e.pointerId);
        held = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, up: false };
        return;
      }
      if (!begin(e.clientX, e.clientY)) return;
      e.preventDefault();
      box.setPointerCapture?.(e.pointerId);
    });
    box.addEventListener('pointermove', (e) => {
      if (held && held.id === e.pointerId && !held.up) {
        held.x = e.clientX;
        held.y = e.clientY;
        return;
      }
      move(e.clientX, e.clientY);
    });
    box.addEventListener('pointerup', (e) => {
      if (held && held.id === e.pointerId) {
        held.x = e.clientX;
        held.y = e.clientY;
        held.up = true;
        return;
      }
      void end(e.clientX, e.clientY);
    });
    box.addEventListener('pointercancel', () => {
      held = null;
      drop();
    });
  }

  /* ---------- 裝信、封口 ---------- */
  const insertLetter = async () => {
    const cc = cRef.current;
    if (!cc || cc.inserted) return;
    const pkEl = $('#ctFold .pk'),
      ev = $('#ctEnv .envf');
    let n: CounterDTO;
    try {
      n = await api.insert(id);
    } catch (e) {
      if (isApiError(e, 'TOO_WIDE') || isApiError(e, 'TOO_LONG')) {
        if (pkEl) await anim(pkEl, [{ translate: '0 0' }, { translate: '-7px 0' }, { translate: '6px 0' }, { translate: '-3px 0' }, { translate: '0 0' }], { d: 420, e: 'linear' });
        toast(e.message);
      } else toast((e as Error).message);
      return;
    }
    if (pkEl && ev) {
      const a = pkEl.getBoundingClientRect(),
        b = ev.getBoundingClientRect(),
        dx = b.left + b.width / 2 - (a.left + a.width / 2),
        dy = b.top + b.height / 2 - (a.top + a.height / 2);
      await anim(
        pkEl,
        [
          { translate: '0 0', scale: '1', opacity: 1 },
          { translate: `${dx}px ${dy - 30}px`, scale: '.75', opacity: 1, offset: 0.7 },
          { translate: `${dx}px ${dy}px`, scale: '.6', opacity: 0 },
        ],
        { d: 1150, e: INOUT },
      );
    }
    for (const a of $$('#ctAtts .catt')) {
      if (!ev) break;
      const r1 = a.getBoundingClientRect(),
        b = ev.getBoundingClientRect();
      await anim(
        a,
        [
          { translate: '0 0', opacity: 1 },
          { translate: `${b.left + b.width / 2 - (r1.left + r1.width / 2)}px ${b.top + b.height / 2 - (r1.top + r1.height / 2)}px`, scale: '.4', opacity: 0 },
        ],
        { d: 700, e: INOUT },
      );
    }
    if (ev) void anim(ev, [{ scale: '1' }, { scale: '1.02' }, { scale: '1' }], { d: 300 });
    setC(n);
    toast('放進去了。');
  };

  const sealEnv = async () => {
    const cc = cRef.current;
    if (!cc) return;
    if (!cc.inserted) {
      toast('信還沒放進信封。');
      return;
    }
    if (cc.sealed) return;
    let n: CounterDTO;
    try {
      n = await api.seal(id);
    } catch (e) {
      toast((e as Error).message);
      return;
    }
    const host = envRef.current!;
    await anim(host, [{ transform: 'none' }, { transform: 'translateY(-10px) scaleX(0)' }], { d: 380, e: 'cubic-bezier(.5,0,.9,.5)' });
    host.innerHTML = envBackHTML(counterPkg(cc), {}, prefs.era);
    const flap = $('.eb-flap', host),
      strip = $('.eb-strip', host),
      wx = $('.eb-wax', host);
    if (wx) wx.style.opacity = '0';
    await anim(host, [{ transform: 'translateY(-10px) scaleX(0)' }, { transform: 'none' }], { d: 440, e: 'cubic-bezier(.1,.5,.3,1)' });
    if (flap) await anim(flap, [{ transform: 'scaleY(-1)', opacity: 0.4 }, { transform: 'scaleY(1.03)', opacity: 1, offset: 0.8 }, { transform: 'none', opacity: 1 }], { d: 900, e: INOUT });
    if (strip) await anim(strip, [{ opacity: 0.3, translate: '0 -6px' }, { opacity: 1, translate: '0 0' }], { d: 600 });
    if (wx) await anim(wx, [{ transform: 'scale(1.9)', opacity: 0 }, { transform: 'scale(.9)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { d: 750, e: 'cubic-bezier(.3,1.4,.5,1)' });
    await wait(500);
    await anim(host, [{ transform: 'none' }, { transform: 'translateY(-10px) scaleX(0)' }], { d: 380, e: 'cubic-bezier(.5,0,.9,.5)' });
    setC(n);
    requestAnimationFrame(() => void anim(envRef.current, [{ transform: 'translateY(-10px) scaleX(0)' }, { transform: 'none' }], { d: 440, e: 'cubic-bezier(.1,.5,.3,1)' }));
    toast(n.env === 'wax' ? '蠟封好了。' : '封好了。');
  };

  /* ---------- 地址 ---------- */
  const saveEnv = (k: keyof EnvAddress, v: string) => {
    const next = { ...env, [k]: v };
    setEnv(next);
    if (/Email/.test(k) && c) setC({ ...c, addrOk: false, missing: c.missing.includes('ADDRESS') ? c.missing : ['ADDRESS', ...c.missing] });
    if (envSave.current.t) clearTimeout(envSave.current.t);
    envSave.current.t = setTimeout(() => {
      envSave.current.t = null;
      envSave.current.p = api
        .patchLetter(id, { env: Object.fromEntries(Object.entries(next).map(([a, b]) => [a, b.trim()])) })
        .then((nl) => {
          onLetter({ ...nl, trip: L.trip });
          return api.counter(id).then(setC);
        })
        .catch((e) => toast((e as Error).message));
    }, 400);
  };
  const flushEnv = async () => {
    if (envSave.current.t) {
      clearTimeout(envSave.current.t);
      envSave.current.t = null;
      envSave.current.p = api.patchLetter(id, { env: Object.fromEntries(Object.entries(env).map(([a, b]) => [a, b.trim()])) });
    }
    await envSave.current.p.catch(() => undefined);
  };

  const confirmAddr = () => {
    const e = env;
    if (!okMail(e.fromEmail.trim()) || !okMail(e.toEmail.trim())) {
      toast('寄件人和收件人的電子信箱都要填，格式像 name@example.com。');
      return;
    }
    openModal({
      content: (
        <>
          <div className="mhead">
            <b>請確認地址</b>
          </div>
          <p style={{ margin: 0 }}>如無法收信，退回所需時間很長。</p>
          <div className="calc">
            <ol style={{ listStyle: 'none', padding: 0 }}>
              <li>
                收件人信箱：<b>{e.toEmail}</b>
              </li>
              <li>收件人地址：{e.toAddr || '（沒填）'}</li>
              <li>
                寄件人信箱：<b>{e.fromEmail}</b>
              </li>
              <li>寄件人地址：{e.fromAddr || '（沒填）'}</li>
            </ol>
          </div>
          <AddrFoot
            onYes={async () => {
              await flushEnv();
              try {
                setC(await api.confirmAddress(id));
                closeModal();
                toast('地址確認了。');
              } catch (err) {
                toast((err as Error).message);
              }
            }}
          />
        </>
      ),
    });
  };

  /* ---------- 上傳信封、郵票、郵戳 ---------- */
  const envFileRef = useRef<HTMLInputElement>(null);
  const uploadAnd = async (f: File | undefined, purpose: 'skin' | 'stamp' | 'postmark', patch: (attId: string) => Parameters<typeof api.patchCounter>[1]) => {
    if (!f) return;
    try {
      const cv = await readImg(f, 900);
      const a = await api.upload(id, await toJpeg(cv), purpose, purpose + '.jpg');
      setC(await api.patchCounter(id, patch(a.id)));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const patchCounter = async (p: Parameters<typeof api.patchCounter>[1]) => {
    try {
      setC(await api.patchCounter(id, p));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const goHome = async () => {
    try {
      await flushEnv();
      await api.goHome(id);
      nav('/desk');
      toast('回家了。郵局裡做過的事都還留著，摺痕也是。');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (!c || !pk) return <p className="hint">櫃台的人正在找信封…</p>;
  const lk = c.envLocked;
  const steps: [string, boolean][] = [
    ['確認地址', c.addrOk],
    ...(pc
      ? []
      : ([
          ['摺好、放進信封', c.inserted],
          ['封口', c.sealed],
        ] as [string, boolean][])),
    ['貼郵票', !!c.stampPos],
    ['蓋郵戳（可不蓋）', !!c.pmPos],
    ['拖進郵筒', false],
  ];

  return (
    <div className="counter">
      <div className="ct-table">
        <div className="ct-head">
          <h2 className="h2">{trip.placeName}・櫃台</h2>
          <span className="hint">東西都攤在桌上。摺信、貼郵票、蓋郵戳都沒有輔助線，也不能重來。</span>
        </div>
        <div className="ct-main">
          <div className={'ct-envwrap' + (c.env === 'chinese' ? ' v' : '')}>
            <div id="ctEnv" className="ct-env" ref={envRef} onPointerDown={onEnvPointerDown} />
            <textarea ref={eimeRef} id="eime" className="ime" aria-label="在信封上打字" autoComplete="off" spellCheck={false} />
          </div>
          <div className="ct-box" id="ctBox" ref={boxRef}>
            <div className="pbx-host" dangerouslySetInnerHTML={{ __html: postboxHTML(trip.box, prefs.era) }} />
            <span className="hint">都準備好了，把信封拖進投遞口。</span>
          </div>
        </div>
        <div className="ct-low">
          {!pc && (
            <div className="ct-foldwrap">
              <span className="label">摺信</span>
              <div id="ctFold" className="ct-fold" ref={foldRef}></div>
              <span className="hint" id="foldInfo"></span>
            </div>
          )}
          <div className="ct-tray">
            <span className="label">郵票與郵戳</span>
            <div className="tray-row">
              {c.stampPos ? (
                <span className="hint">郵票貼好了。</span>
              ) : (
                <div className="tray-stamp" id="trayStamp" title="拖到信封上" onPointerDown={dragStamp} dangerouslySetInnerHTML={{ __html: stampArt(pk.stamp, pk.stampSrc) }} />
              )}
              {c.pmPos ? (
                <span className="hint">郵戳蓋好了。</span>
              ) : (
                <div className="tray-pm" id="trayPm" title="拖到信封上蓋下去" onPointerDown={dragPm} dangerouslySetInnerHTML={{ __html: rubberSVG() }} />
              )}
            </div>
            {L.attachments.length > 0 && !pc && (
              <>
                <span className="label">附件</span>
                <div className="ct-atts" id="ctAtts">
                  {c.inserted ? <span className="hint">附件跟著信放進去了。</span> : L.attachments.map((a) => <img key={a.id} className="catt" src={attachmentUrl(a.id)} alt="附件照片" />)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <aside className="panel ct-side">
        <div>
          <button type="button" className="btn small ghost" id="goHome" onClick={() => void goHome()}>
            先帶著信回家
          </button>
        </div>
        {pc ? (
          <p className="hint">明信片不用信封，地址和郵票直接在背面。</p>
        ) : (
          <div className="tgroup">
            <span className="label">信封</span>
            <div className="envopts">
              {(Object.entries(ENVS) as [EnvelopeKind, (typeof ENVS)['post']][])
                .filter(([k]) => k !== 'card')
                .map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    className="eo"
                    data-env={k}
                    aria-pressed={c.env === k}
                    disabled={lk}
                    onClick={() => {
                      if (k === 'custom' && !c.skinAttachmentId) {
                        envFileRef.current?.click();
                        return;
                      }
                      void patchCounter({ env: k });
                    }}
                  >
                    <b>{v.label}</b>
                    <small>{v.sub}</small>
                  </button>
                ))}
            </div>
            <label className={'btn small' + (lk ? ' dis' : '')}>
              上傳信封圖
              <input
                ref={envFileRef}
                type="file"
                accept="image/*"
                hidden
                disabled={lk}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  void uploadAnd(f, 'skin', (a) => ({ skinAttachmentId: a }));
                }}
              />
            </label>
          </div>
        )}
        <div className="tgroup">
          <span className="label">郵票</span>
          <div className="seg" id="stSeg2">
            {(Object.entries(STAMPS) as [StampId, string][]).map(([k, v]) => (
              <button key={k} type="button" data-v={k} aria-pressed={!c.stampAttachmentId && c.stamp === k} disabled={!!c.stampPos} onClick={() => void patchCounter({ stamp: k })}>
                {v}
              </button>
            ))}
          </div>
          <label className={'btn small' + (c.stampPos ? ' dis' : '')}>
            上傳郵票
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={!!c.stampPos}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void uploadAnd(f, 'stamp', (a) => ({ stampAttachmentId: a }));
              }}
            />
          </label>
        </div>
        <div className="tgroup">
          <span className="label">郵戳</span>
          <div className="seg" id="pmSeg">
            {(Object.entries(PMS) as [PostmarkId, string][]).map(([k, v]) => (
              <button key={k} type="button" data-v={k} aria-pressed={!c.pmAttachmentId && c.pm === k} disabled={!!c.pmPos} onClick={() => void patchCounter({ pm: k })}>
                {v}
              </button>
            ))}
          </div>
          <label className={'btn small' + (c.pmPos ? ' dis' : '')}>
            上傳郵戳
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={!!c.pmPos}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void uploadAnd(f, 'postmark', (a) => ({ pmAttachmentId: a }));
              }}
            />
          </label>
        </div>
        <div className="tgroup" style={{ width: '100%' }}>
          <span className="label">地址</span>
          <div className="envform">
            {[0, 1].map((g) => (
              <div className="grp" key={g}>
                <span className="hint">{g ? '收件人' : '寄件人'}</span>
                {ADDR_FIELDS.slice(g * 3, g * 3 + 3).map(([k, ph, type]) => (
                  <input key={k} data-k={k} type={type} value={env[k]} placeholder={ph} autoComplete="off" onChange={(e) => saveEnv(k, e.target.value)} />
                ))}
              </div>
            ))}
          </div>
          <button type="button" className={'btn' + (c.addrOk ? '' : ' primary')} id="addrBtn" onClick={confirmAddr}>
            {c.addrOk ? '地址確認過了・再看一次' : '確認地址'}
          </button>
        </div>
        <div className="tgroup">
          <span className="label">信封上的字（選填）</span>
          <div className="seg" id="emSeg">
            {(
              [
                ['type', '打字機'],
                ['hand', '手寫'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" data-v={v} aria-pressed={c.emode === v} onClick={() => void patchCounter({ emode: v })}>
                {l}
              </button>
            ))}
          </div>
          <div className="row2">
            <button type="button" className="btn small" data-zone="to" aria-pressed={zone === 'to'} onClick={() => setZone('to')}>
              寫收件人
            </button>
            <button type="button" className="btn small" data-zone="from" aria-pressed={zone === 'from'} onClick={() => setZone('from')}>
              寫寄件人
            </button>
            {zone && (
              <button type="button" className="btn small" data-zone="" onClick={() => setZone(null)}>
                寫好了
              </button>
            )}
          </div>
          <p className="hint">跟寫信一樣，寫上去就擦不掉。</p>
        </div>
        {!pc && (
          <div className="tgroup">
            <span className="label">裝信</span>
            <div className="row2">
              <button type="button" className="btn small" id="rotBtn" disabled={c.inserted} onClick={() => void patchCounter({ rot: !c.rot })}>
                轉個方向
              </button>
              <button type="button" className="btn small primary" id="insBtn" disabled={c.inserted} onClick={() => void insertLetter()}>
                放進信封
              </button>
              <button type="button" className="btn small" id="sealBtn" disabled={!c.inserted || c.sealed} onClick={() => void sealEnv()}>
                {c.sealed ? '封好了' : '封口'}
              </button>
            </div>
            <p className="hint">從信紙的邊緣往內拖就會摺。塞不進信封就再摺一次，摺痕會留著。</p>
          </div>
        )}
        <ul className="steps" id="steps">
          {steps.map(([t, ok]) => (
            <li key={t} className={ok ? 'ok' : ''}>
              {ok ? '✓' : '○'} {t}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function AddrFoot({ onYes }: { onYes: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mfoot">
      <button type="button" className="btn" data-close>
        再看一次
      </button>
      <button
        type="button"
        className="btn primary"
        id="addrYes"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onYes();
          setBusy(false);
        }}
      >
        地址沒錯
      </button>
    </div>
  );
}

export { Confirm };
