/**
 * 收信：用開信連結進來（/r/:token）。翻面、開信刀／手撕／易撕帶、偏離 1.5 秒撕毀、碎片拖曳與旋轉自己拼、
 * 撬郵票與火漆、倒出來、攤開（摺痕都在）、收進收藏。
 * 每一步都送到後端（毛邊、紙纖維由伺服器擲骰）；撕毀的判定（D-013 暫定）在前端依軌跡判斷後回報位置。
 */
import type { Piece, ReceiveDTO } from '@manxin/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, isApiError, recvAttachmentUrl } from '../api/client.ts';
import { Empty, SheetThumb } from '../components/common.tsx';
import { FlipCard } from '../components/DeskModals.tsx';
import { ENVS, envBackHTML, envFrontHTML, paintZones, type ViewPkg } from '../lib/art.ts';
import { anim, INOUT, RM } from '../lib/motion.ts';
import { loadFont, mountSheet, viewSheet, type ViewSheet } from '../lib/paper.ts';
import { arriveLetter, openMouth } from '../lib/scenes.ts';
import { DESKS, rememberToken } from '../lib/prefs.ts';
import { $, $$, el, hash, jit, rng, spaced } from '../lib/util.ts';
import { useApp } from '../state/app.tsx';
import { InboxList } from './Inbox.tsx';

export function recvPkg(dto: ReceiveDTO, token: string): ViewPkg {
  const p = dto.pkg;
  const f = (id: string | null) => (id ? recvAttachmentUrl(token, id) : null);
  return {
    env: p.env,
    stamp: p.stamp,
    stampSrc: f(p.stampAttachmentId),
    pm: p.pm,
    pmSrc: f(p.pmAttachmentId),
    skin: f(p.skinAttachmentId),
    stampPos: p.stampPos,
    pmPos: p.pmPos,
    pmAt: p.pmAt,
    etxt: p.etxt,
    // D-028：信封上的字跟信紙同一個字型；自訂字型用開信連結載入（舊資料沒有 efont 就用文楷）
    efont: loadFont(p.efont || 'kai', p.efontUrl),
    folds: p.folds,
    pack: p.pack,
    rot: p.rot,
  };
}

export const recvSheet = (dto: ReceiveDTO, token: string): ViewSheet | null => (dto.letter ? viewSheet(dto.letter.sheet, (id) => recvAttachmentUrl(token, id)) : null);

/** 攤開的信：信紙加上摺痕 */
export function mountLetter(host: HTMLElement, sheet: ViewSheet, folds: ReceiveDTO['pkg']['folds'], W: number, env?: { toName?: string; toEmail?: string; toAddr?: string }): void {
  mountSheet(host, sheet, W, env);
  (folds || []).forEach((f) => {
    const at = Math.max(0, f.at) * W;
    host.insertAdjacentHTML('beforeend', f.a === 'h' ? `<i class="crease-h" style="top:${at}px"></i>` : `<i class="crease-v" style="left:${at}px"></i>`);
  });
}

function tearPoly(seed: string, x: number, left: boolean): string {
  const g = rng(seed),
    P: string[] = [];
  for (let i = 0; i <= 14; i++) P.push(`${(x * 100 + (g() - 0.5) * 7).toFixed(1)}% ${((i / 14) * 100).toFixed(1)}%`);
  return left ? `polygon(0% 0%,${P.join(',')},0% 100%)` : `polygon(${P.join(',')},100% 100%,100% 0%)`;
}

/** 撕成兩半的信封與信紙：拖動碎片自己拼，右上角的圓鈕可以轉方向（readOnly：收藏裡只看） */
export function renderPieces(box: HTMLElement, dto: ReceiveDTO, token: string, era: 'minguo' | '80s' | 'doodle' | 'map', onMove?: (p: Piece) => void): void {
  const r = dto.recv,
    pk = recvPkg(dto, token),
    sheet = recvSheet(dto, token);
  if (!r.torn || !r.pieces) return;
  const ro = !onMove;
  const W = Math.min(300, (box.clientWidth || 600) * 0.5);
  box.innerHTML = '';
  r.pieces.forEach((p0, i) => {
    const p = { ...p0 };
    const d = el('div', 'piece'),
      inner = el('div', 'pc-in'),
      isEnv = p.k[0] === 'e',
      left = p.k[1] === 'L';
    d.append(inner);
    if (!ro) d.insertAdjacentHTML('beforeend', '<span class="knob" title="轉方向"></span>');
    box.append(d);
    if (isEnv) {
      inner.style.width = W + 'px';
      inner.innerHTML = envBackHTML(pk, { opened: true }, era);
    } else if (sheet) mountSheet(inner, sheet, W, {});
    inner.style.clipPath = tearPoly(r.torn!.seed + (isEnv ? 'e' : 'l'), r.torn!.x, left);
    const place = () => {
      d.style.transform = `translate(-50%,-50%) translate(${p.x}px,${p.y}px) rotate(${p.rot}deg)`;
    };
    place();
    d.style.zIndex = isEnv ? '1' : '2';
    if (ro) return;
    d.onpointerdown = (e) => {
      if ((e.target as HTMLElement).classList.contains('knob')) return;
      e.preventDefault();
      d.setPointerCapture?.(e.pointerId);
      const sx = e.clientX - p.x,
        sy = e.clientY - p.y;
      d.style.zIndex = String(10 + i);
      const mv = (ev: PointerEvent) => {
        p.x = ev.clientX - sx;
        p.y = ev.clientY - sy;
        place();
      };
      const upf = () => {
        d.removeEventListener('pointermove', mv);
        d.removeEventListener('pointerup', upf);
        onMove!({ ...p });
      };
      d.addEventListener('pointermove', mv);
      d.addEventListener('pointerup', upf);
    };
    const kn = $('.knob', d)!;
    kn.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      kn.setPointerCapture?.(e.pointerId);
      const b = d.getBoundingClientRect(),
        cx = b.left + b.width / 2,
        cy = b.top + b.height / 2,
        a0 = Math.atan2(e.clientY - cy, e.clientX - cx),
        r0 = p.rot;
      const mv = (ev: PointerEvent) => {
        p.rot = r0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
        place();
      };
      const upf = () => {
        kn.removeEventListener('pointermove', mv);
        kn.removeEventListener('pointerup', upf);
        onMove!({ ...p });
      };
      kn.addEventListener('pointermove', mv);
      kn.addEventListener('pointerup', upf);
    };
  });
  if (!ro && !RM) $$('.piece', box).forEach((d, i) => void anim(d, [{ opacity: 0 }, { opacity: 1 }], { d: 500, delay: i * 90 }));
}

export function ReceivePage() {
  const { token = '' } = useParams();
  return (
    <div className="track-grid">
      <InboxList current={token} />
      <div className="detail" id="rvDetail">
        <ReceiveView token={token} key={token} />
      </div>
    </div>
  );
}

function ReceiveView({ token }: { token: string }) {
  const app = useApp();
  const nav = useNavigate();
  const { toast, prefs, openModal } = app;
  const [dto, setDto] = useState<ReceiveDTO | null>(null);
  const [err, setErr] = useState<{ code: string; msg: string } | null>(null);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [tool, setTool] = useState<'knife' | 'tear'>('knife');
  const [avail, setAvail] = useState(600);
  const wrapRef = useRef<HTMLDivElement>(null);
  const envRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const piecesRef = useRef<HTMLDivElement>(null);
  const dtoRef = useRef(dto);
  dtoRef.current = dto;
  const pieceSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrived = useRef(false);
  const pendingPieces = useRef<Map<string, Piece>>(new Map());

  const fail = useCallback(
    (e: unknown) => {
      if (isApiError(e, 'INVALID_TOKEN')) setErr({ code: 'INVALID_TOKEN', msg: '這個開信連結不存在或已失效（寄件人可能改了收件信箱）。' });
      else if (isApiError(e, 'GONE')) setErr({ code: 'GONE', msg: '這封信已經退回寄件人了。' });
      else toast((e as Error).message);
    },
    [toast],
  );

  // 點開連結就算「打開連結」（明信片一進來就算打開，也就是簽收）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let d = await api.recv(token);
        if (!d.recv.entered) {
          d = await api.recvEnter(token);
          if (d.recv.opened) void app.refreshCounts();
        }
        rememberToken(d.no, token);
        if (alive) setDto(d);
      } catch (e) {
        if (alive) fail(e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useLayoutEffect(() => {
    const host = wrapRef.current?.closest('.detail') as HTMLElement | null;
    if (!host) return;
    const ro = new ResizeObserver(() => setAvail((host.clientWidth || 620) - 44));
    ro.observe(host);
    setAvail((host.clientWidth || 620) - 44);
    return () => ro.disconnect();
  }, [dto ? 1 : 0]);

  const pk = dto ? recvPkg(dto, token) : null;
  const E = pk ? ENVS[pk.env] || ENVS.kraft : ENVS.kraft;
  const pc = pk?.env === 'card';
  const r = dto?.recv;
  const sheet = dto ? recvSheet(dto, token) : null;
  const W = Math.min(pc ? 460 : E.ar < 1 ? 210 : 440, avail);
  const front = dto?.letter?.frontAttachmentId ? recvAttachmentUrl(token, dto.letter.frontAttachmentId) : null;

  /* ---------- 信封（正面或背面） ---------- */
  const envKey = dto ? JSON.stringify([dto.recv, side, tool, W, prefs.era, !!sheet]) : '';
  useLayoutEffect(() => {
    const host = envRef.current;
    if (!host || !dto || !pk || !r || r.torn) return;
    if (pc || side === 'front') {
      host.innerHTML = envFrontHTML(pk, { office: dto.office, t: dto.sentAt, stampTaken: r.stampTaken, stampFiber: r.stampFiber });
      if (pc && sheet) {
        const card = $('.ev-card', host);
        if (card) mountSheet(card, sheet, W, {});
      }
      paintZones(host, pk);
      const st = $('.ev-stamp', host);
      if (st && !r.stampTaken) holdToPry(st, 950, () => void pryStamp(st));
    } else {
      host.innerHTML = envBackHTML(pk, r, prefs.era);
      if (!r.opened) bindOpen($('.envb', host)!);
      const wx = $('.eb-wax', host);
      if (wx && !r.waxTaken && !r.opened) holdToPry(wx, 1000, () => void pryWax(wx));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envKey]);

  /* 第一次看到這封信（還沒拆）：信輕輕落到桌上。只是表現，不擋任何操作 */
  useEffect(() => {
    if (!dto || arrived.current) return;
    arrived.current = true;
    if (dto.recv.opened || dto.recv.torn) return;
    const h = envRef.current;
    if (h) void arriveLetter(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dto ? 1 : 0]);

  /* ---------- 倒出來的東西、攤開的信 ---------- */
  const outKey = dto ? JSON.stringify([r?.poured, r?.unfolded, dto.attachments?.length, !!sheet, avail]) : '';
  useLayoutEffect(() => {
    const out = outRef.current;
    if (!out || !dto || !r || pc || r.torn) return;
    if (!r.poured) {
      out.innerHTML = '';
      return;
    }
    if (!r.unfolded) {
      const P = dto.pkg.pack ?? { x0: 0, y0: 0, x1: 1, y1: 1.414 },
        sc = 150,
        w = (P.x1 - P.x0) * sc,
        h = (P.y1 - P.y0) * sc;
      out.innerHTML =
        `<div class="rv-item rv-pack" style="width:${dto.pkg.rot ? h : w}px;height:${dto.pkg.rot ? w : h}px" role="button" tabindex="0" aria-label="攤開信紙"></div>` +
        (dto.attachments ?? []).map((a) => `<img class="rv-item catt" src="/api${a.url}" alt="附件照片">`).join('');
      const p = $('.rv-pack', out)!;
      p.onclick = () => void unfold();
      p.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void unfold();
        }
      };
    } else if (sheet) {
      out.innerHTML =
        '<div class="rv-letter" id="rvLetter"></div>' +
        ((dto.attachments ?? []).length
          ? `<div class="atts">${dto.attachments!.map((a) => `<div class="att" style="--r:${(hash(a.id) % 9) - 4}deg"><span class="clip"></span><img src="/api${a.url}" alt="附件照片"></div>`).join('')}</div>`
          : '');
      mountLetter($('#rvLetter', out)!, sheet, dto.pkg.folds, Math.min(520, avail));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outKey]);

  /* ---------- 撕破的碎片 ---------- */
  const piecesKey = dto?.recv.torn ? JSON.stringify([dto.recv.torn, !!sheet, prefs.era]) : '';
  useLayoutEffect(() => {
    const box = piecesRef.current;
    if (!box || !dto || !dto.recv.torn) return;
    renderPieces(box, dto, token, prefs.era, (p) => {
      pendingPieces.current.set(p.k, p);
      if (pieceSave.current) clearTimeout(pieceSave.current);
      pieceSave.current = setTimeout(() => {
        const ps = [...pendingPieces.current.values()];
        pendingPieces.current.clear();
        api.recvPieces(token, ps).catch(fail);
      }, 300);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piecesKey]);

  /** 按住慢慢撬：郵票、火漆 */
  function holdToPry(elm: HTMLElement, ms: number, onDone: () => void) {
    let t: ReturnType<typeof setTimeout> | null = null,
      a: Animation | null = null;
    elm.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      elm.setPointerCapture?.(e.pointerId);
      a = elm.animate?.([{ translate: '0 0', rotate: '0deg' }, { translate: '3px -5px', rotate: '-7deg' }], { duration: RM ? 1 : ms, fill: 'forwards', easing: 'ease-in' }) ?? null;
      t = setTimeout(() => {
        t = null;
        onDone();
      }, ms);
    };
    const cancel = () => {
      if (t) {
        clearTimeout(t);
        t = null;
        a?.reverse();
      }
    };
    elm.onpointerup = cancel;
    elm.onpointercancel = cancel;
  }

  async function pryStamp(st: HTMLElement) {
    try {
      const d = await api.recvPryStamp(token);
      await anim(st, [{ opacity: 1, translate: '3px -5px' }, { opacity: 0, translate: '30px -70px', rotate: '25deg' }], { d: 750, e: 'ease-in' });
      setDto(d);
      void app.refreshCounts();
      toast(d.recv.stampFiber ? '郵票撬下來了，背面黏著一點信封的紙纖維。' : '郵票撬下來了。');
    } catch (e) {
      fail(e);
    }
  }
  async function pryWax(wx: HTMLElement) {
    try {
      const d = await api.recvPryWax(token);
      await anim(wx, [{ opacity: 1 }, { opacity: 0, translate: '0 -60px', rotate: '40deg', scale: '1.1' }], { d: 700, e: 'ease-in' });
      setDto(d);
      void app.refreshCounts();
      toast(d.recv.waxFiber ? '火漆撬下來了，背面帶走了一些信封的紙纖維。' : '火漆撬下來了。');
    } catch (e) {
      fail(e);
    }
  }

  /** 開信：沿著正確的位置劃過去。偏太多又停在那裡 1.5 秒，信就撕壞了 */
  function bindOpen(ev: HTMLElement) {
    const d0 = dtoRef.current;
    if (!d0) return;
    const env = d0.pkg.env,
      En = ENVS[env] || ENVS.kraft;
    const band = En.cl === 'strip' ? 0.105 : env === 'chinese' ? 0.04 : 0.06,
      tol = 0.13,
      far = 0.27,
      N = 40,
      cov = new Array<number>(N).fill(0),
      pts: [number, number][] = [];
    let on = false,
      t0: number | null = null,
      timer: ReturnType<typeof setTimeout> | null = null,
      done = false;
    const path = $<SVGPathElement>('.eb-trace path', ev)!;
    const pathD = () => {
      if (tool === 'knife') {
        let d = '',
          i = 0;
        while (i < N) {
          if (cov[i]) {
            let j = i;
            while (j + 1 < N && cov[j + 1]) j++;
            d += `M${((i * 100) / N).toFixed(1)} ${(band * 100).toFixed(1)} L${(((j + 1) * 100) / N).toFixed(1)} ${(band * 100).toFixed(1)} `;
            i = j + 1;
          } else i++;
        }
        return d;
      }
      const p = [...pts].sort((a, b) => a[0] - b[0]);
      return p.length ? 'M' + p.map((q) => `${(q[0] * 100).toFixed(1)} ${(q[1] * 100).toFixed(1)}`).join(' L') : '';
    };
    const calm = () => {
      t0 = null;
      if (timer) clearTimeout(timer);
      ev.classList.remove('strain');
    };
    const finish = async () => {
      if (done) return;
      done = true;
      on = false;
      calm();
      try {
        const d = await api.recvOpen(token, tool, pathD());
        // 已經送出、伺服器說開了；這裡只是收尾的表現：易撕帶掀走／封口掀起來
        await openMouth(ev);
        setDto(d);
        void app.refreshCounts();
        toast(d.recv.rough ? '撕開了。封口撕下半層紙，留下毛毛的邊。' : tool === 'knife' ? '劃開了。' : En.cl === 'strip' ? '易撕帶拉開了。' : '撕開了。');
      } catch (e) {
        done = false;
        fail(e);
      }
    };
    const tearApart = async (x: number) => {
      if (done) return;
      done = true;
      on = false;
      calm();
      try {
        const req = api.recvTear(token, Math.min(0.8, Math.max(0.2, x)));
        if (!RM) await anim(ev, [{ translate: '0 0', rotate: '0deg' }, { translate: '-6px 2px', rotate: '-2deg' }, { translate: '8px -2px', rotate: '2deg' }, { translate: '0 0', rotate: '0deg' }], { d: 260 });
        const d = await req;
        setDto(d);
        void app.refreshCounts();
        toast('撕壞了。信封和信紙都裂成兩半。');
      } catch (e) {
        done = false;
        fail(e);
      }
    };
    const step = (e: PointerEvent) => {
      const b = ev.getBoundingClientRect(),
        x = (e.clientX - b.left) / b.width,
        y = (e.clientY - b.top) / b.height,
        dev = Math.abs(y - band);
      if (dev <= tol && x >= 0 && x <= 1) {
        const i = Math.min(N - 1, Math.floor(x * N));
        if (!cov[i]) {
          cov[i] = 1;
          pts.push([x, band + (tool === 'tear' ? jit(0.025) : 0)]);
        }
        path.setAttribute('d', pathD());
        calm();
      } else if (dev > far) {
        if (!t0) {
          t0 = performance.now();
          ev.classList.add('strain');
          timer = setTimeout(() => {
            if (on) void tearApart(x);
          }, 1500);
        }
      } else calm();
      if (cov.reduce((a, v) => a + v, 0) >= N * 0.85) void finish();
    };
    ev.onpointerdown = (e) => {
      if (dtoRef.current?.recv.opened || (e.target as HTMLElement).closest('.eb-wax')) return;
      e.preventDefault();
      ev.setPointerCapture?.(e.pointerId);
      on = true;
      step(e);
    };
    ev.onpointermove = (e) => {
      if (on) step(e);
    };
    ev.onpointerup = ev.onpointercancel = () => {
      on = false;
      calm();
    };
  }

  const flip = async () => {
    const h = envRef.current;
    if (h) await anim(h, [{ transform: 'none' }, { transform: 'translateY(-10px) scaleX(0)' }], { d: 380, e: 'cubic-bezier(.5,0,.9,.5)' });
    setSide((s) => (s === 'front' ? 'back' : 'front'));
    requestAnimationFrame(() => void anim(envRef.current, [{ transform: 'translateY(-10px) scaleX(0)' }, { transform: 'none' }], { d: 460, e: 'cubic-bezier(.1,.5,.3,1)' }));
  };

  const pour = async () => {
    const h = envRef.current;
    try {
      const req = api.recvPour(token);
      if (h) await anim(h, [{ rotate: '0deg', translate: '0 0' }, { rotate: '-16deg', translate: '0 -10px', offset: 0.5 }, { rotate: '-24deg', translate: '0 -14px' }], { d: 950, e: INOUT });
      setDto(await req);
      requestAnimationFrame(() =>
        $$('#rvOut .rv-item').forEach((it, i) =>
          void anim(
            it,
            [
              { translate: '-60px -130px', rotate: '-30deg', opacity: 0 },
              { translate: '0 6px', rotate: `${jit(6).toFixed(1)}deg`, opacity: 1, offset: 0.75 },
              { translate: '0 0', rotate: '0deg', opacity: 1 },
            ],
            { d: 950, delay: i * 180, e: 'cubic-bezier(.3,.7,.3,1)' },
          ),
        ),
      );
    } catch (e) {
      fail(e);
    }
  };

  const unfold = async () => {
    try {
      const d = await api.recvUnfold(token);
      setDto(d);
      requestAnimationFrame(() => {
        const t = $('#rvLetter');
        if (!t || RM) return;
        const P = d.pkg.pack ?? { x0: 0, y0: 0, x1: 1, y1: 1.414 },
          Wl = t.clientWidth,
          Hl = t.clientHeight;
        void anim(
          t,
          [
            { clipPath: `inset(${Math.max(0, P.y0 * Wl)}px ${Math.max(0, (1 - P.x1) * Wl)}px ${Math.max(0, Hl - P.y1 * Wl)}px ${Math.max(0, P.x0 * Wl)}px)` },
            { clipPath: 'inset(0px 0px 0px 0px)' },
          ],
          { d: 1700, e: INOUT },
        );
      });
    } catch (e) {
      fail(e);
    }
  };

  const collect = async () => {
    try {
      const d = await api.recvCollect(token);
      setDto(d);
      void app.refreshCounts();
      toast(`收進${DESKS[prefs.desk].coll}了。`);
    } catch (e) {
      fail(e);
    }
  };

  if (err)
    return (
      <div ref={wrapRef}>
        <Empty title={err.code === 'GONE' ? '信已經退回了' : '打不開這個連結'}>
          <p>{err.msg}</p>
          <button type="button" className="btn" onClick={() => nav('/')}>
            回首頁
          </button>
        </Empty>
      </div>
    );
  if (!dto || !pk || !r) return <p className="hint" ref={wrapRef as never}>打開信箱…</p>;

  const T: React.ReactNode[] = [];
  if (pc) {
    T.push(
      <button
        key="card"
        type="button"
        className="btn"
        id="rvCard"
        onClick={() => sheet && openModal({ content: <FlipCard front={front} sheet={sheet} env={{}} /> })}
      >
        翻過來看正面
      </button>,
    );
    if (pk.stampPos && !r.stampTaken)
      T.push(
        <span key="h" className="hint">
          想收藏郵票：按住郵票不放，慢慢撬起來。
        </span>,
      );
  } else if (r.torn)
    T.push(
      <span key="h" className="hint">
        信撕成兩半了。拖動碎片自己拼起來，右上角的圓鈕可以轉方向。
      </span>,
    );
  else if (!r.opened) {
    if (side === 'front') {
      T.push(
        <button key="f" type="button" className="btn" id="rvFlip" onClick={() => void flip()}>
          翻到背面
        </button>,
      );
      if (pk.stampPos && !r.stampTaken)
        T.push(
          <span key="h" className="hint">
            想收藏郵票：按住郵票不放，慢慢撬起來。
          </span>,
        );
    } else {
      T.push(
        <button key="f" type="button" className="btn" id="rvFlip" onClick={() => void flip()}>
          翻到正面
        </button>,
        <div key="tool" className="seg" id="rvTool">
          <button type="button" data-v="knife" aria-pressed={tool === 'knife'} onClick={() => setTool('knife')}>
            開信刀
          </button>
          <button type="button" data-v="tear" aria-pressed={tool === 'tear'} onClick={() => setTool('tear')}>
            {E.cl === 'strip' ? '拉易撕帶' : '用手撕'}
          </button>
        </div>,
      );
      if (E.cl === 'wax' && !r.waxTaken)
        T.push(
          <span key="w" className="hint">
            火漆可以不管它；想收藏，就按住火漆不放把它撬下來。
          </span>,
        );
      T.push(
        <span key="h" className="hint">
          {E.cl === 'strip' ? '沿著紅色易撕帶，從一頭拉到另一頭。' : '沿著信封最上緣，從一頭劃到另一頭。'}
        </span>,
      );
    }
  } else if (!r.poured)
    T.push(
      <button key="p" type="button" className="btn primary" id="rvPour" onClick={() => void pour()}>
        倒出來
      </button>,
    );
  else if (!r.unfolded)
    T.push(
      <span key="h" className="hint">
        點一下摺起來的信紙，把它攤開。
      </span>,
    );
  if (r.unfolded && !r.collected)
    T.push(
      <button key="k" type="button" className="btn primary" id="rvKeep" onClick={() => void collect()}>
        收進收藏
      </button>,
    );
  else if (r.collected)
    T.push(
      <span key="c" className="hint">
        收好了，放在「收藏」的{DESKS[prefs.desk].coll}裡。
      </span>,
    );

  return (
    <div className="rv-table" ref={wrapRef}>
      <div className="rv-head">
        <span className="h2" style={{ fontSize: 20 }}>
          {dto.fromName || '有個人'}寄來的{pc ? '明信片' : '信'}
        </span>
        <span className="hint">{spaced(dto.no)}</span>
      </div>
      {r.torn ? (
        <div className="rv-pieces" id="rvPieces" ref={piecesRef}></div>
      ) : (
        <>
          <div className="rv-envwrap" style={{ width: W }}>
            <div id="rvEnv" ref={envRef}></div>
          </div>
          <div className="rv-out" id="rvOut" ref={outRef}></div>
        </>
      )}
      <div className="rv-tools">{T}</div>
    </div>
  );
}

export { SheetThumb };
