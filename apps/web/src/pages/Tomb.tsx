/**
 * 字紙冢：未寄出的信（先放著，每 30 天問一次）與廢紙（揉成團／對摺／完好）。容器跟著書桌變。
 */
import type { LetterDTO, TombDTO, TombItemDTO } from '@manxin/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, attachmentUrl } from '../api/client.ts';
import { SheetThumb } from '../components/common.tsx';
import { letterHas, loadCurrentLetter } from '../lib/letters.ts';
import { anim, RM } from '../lib/motion.ts';
import { mountSheet, textOf, viewSheet } from '../lib/paper.ts';
import { DESKS } from '../lib/prefs.ts';
import { D, fmt } from '../lib/time.ts';
import { el, hash } from '../lib/util.ts';
import { paperObj, sheetMarks, unfoldFrom, type TombView } from '../lib/wastepaper.ts';
import { useApp } from '../state/app.tsx';

const LAB = { crumple: '揉成一團', fold: '隨手對摺', keep: '保持完好' } as const;

export function TombPage() {
  const app = useApp();
  const nav = useNavigate();
  const { prefs, toast, openModal } = app;
  const [data, setData] = useState<TombDTO | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.tomb());
    } catch (e) {
      toast((e as Error).message);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load, app.timeVersion]);

  const takeOut = async (u: LetterDTO) => {
    try {
      const cur = await loadCurrentLetter(prefs.era, false);
      if (cur?.trip) {
        toast('你正在去郵局的路上，回來再拿。');
        return;
      }
      if (cur && letterHas(cur)) await api.shelve(cur.id);
      await api.unshelve(u.id);
      void app.refreshCounts();
      nav('/desk');
      toast('信拿出來放回書桌上了。');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (!data) return <p className="hint">打開{DESKS[prefs.desk].tomb}…</p>;
  const now = app.now();
  return (
    <>
      <div className="tomb-head">
        <h2 className="h2">字紙冢・{DESKS[prefs.desk].tomb}</h2>
        <p className="hint">敬惜字紙。寫過字的紙不隨手丟，先放在這裡。</p>
      </div>
      <div className="section">
        <span className="label">未寄出的信・{data.unsent.length} 封</span>
        <div className="unsent" id="uList">
          {!data.unsent.length && <p className="hint">抽屜是空的。</p>}
          {data.unsent.map((u) => {
            const at = u.shelvedAt ?? u.createdAt;
            const d = Math.floor((now - at) / D);
            const since = Math.floor((now - (u.askedAt ?? at)) / D);
            const vs = viewSheet(u.sheet, attachmentUrl);
            return (
              <div key={u.id} className="uenv">
                <span className="to">給 {u.env.toName || '（還沒寫收件人）'}</span>
                <span className="ex">{textOf(u.sheet).replace(/\n+/g, ' ').slice(0, 60) || '（手寫或紙本）'}</span>
                <span className="m">
                  {fmt(at, { time: false })} 放進來・{d} 天{u.askDue ? '・該問問你了' : `・${Math.max(1, 30 - since)} 天後再問`}
                </span>
                <span className="row">
                  <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                      openModal({
                        content: (
                          <>
                            <div className="mhead">
                              <b>未寄出的信</b>
                              <button type="button" className="btn small" data-close>
                                放回去
                              </button>
                            </div>
                            <div className="mcenter">
                              <SheetThumb sheet={vs} width={Math.min(560, innerWidth - 80)} env={u.env} />
                            </div>
                          </>
                        ),
                      })
                    }
                  >
                    看看
                  </button>
                  <button type="button" className="btn small" onClick={() => void takeOut(u)}>
                    拿出來
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="section" style={{ marginTop: 28 }}>
        <span className="label">廢紙・{data.sheets.length} 張</span>
        <div className="tomb-grid" id="tList">
          <span className="plaque">敬惜字紙</span>
          {!data.sheets.length && <p className="hint tray-empty">還沒有廢紙。</p>}
          {data.sheets.map((it, k) => (
            <TombItem key={it.sheet.id} it={it} k={k} />
          ))}
        </div>
      </div>
    </>
  );
}

function TombItem({ it, k }: { it: TombItemDTO; k: number }) {
  const { openModal } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLElement | null>(null);
  const tv: TombView = { sheet: viewSheet(it.sheet, attachmentUrl), state: it.state };
  const tilt = (hash(it.sheet.id + 't') % 11) - 5;
  useLayoutEffect(() => {
    const w = ref.current;
    if (!w) return;
    w.replaceChildren();
    const obj = paperObj(tv, w);
    objRef.current = obj;
    const lab = LAB[it.state];
    w.append(el('span', 'tag', `<i class="hole"></i><b>${lab}</b><span>${fmt(it.discardedAt, { time: false, wk: false })}</span>`));
    obj.setAttribute('role', 'button');
    obj.tabIndex = 0;
    obj.setAttribute('aria-label', `${lab}的廢紙，點開來看`);
    const open = () => {
      const r0 = obj.getBoundingClientRect();
      openModal({ content: <TombOpen tv={tv} r0={r0} /> });
    };
    obj.onclick = open;
    obj.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
    if (!RM)
      void anim(
        w,
        [
          { opacity: 0, transform: `translateY(-26px) rotate(${tilt * 3}deg)` },
          { opacity: 1, transform: `translateY(2px) rotate(${tilt}deg)`, offset: 0.75 },
          { opacity: 1, transform: `rotate(${tilt}deg)` },
        ],
        { d: 800, delay: 120 + k * 110, e: 'cubic-bezier(.3,.7,.3,1)' },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.sheet.id, it.state]);
  return <div className="titem" ref={ref} style={{ ['--tilt' as string]: tilt + 'deg' }} />;
}

/** 攤開來看：從紙團／對摺／平放的樣子，變回一整張帶著皺褶的信紙 */
function TombOpen({ tv, r0 }: { tv: TombView; r0: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const b = host.closest<HTMLElement>('.mbox')!;
    b.classList.remove('settle');
    const W = Math.min(560, innerWidth - 80);
    mountSheet(host, tv.sheet, W);
    sheetMarks(host, tv);
    if (RM) return;
    host.style.visibility = 'hidden';
    b.style.opacity = '0';
    requestAnimationFrame(() => void unfoldFrom(tv, r0, host, b, W).then(() => (b.style.opacity = '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className="mhead">
        <b>{tv.state === 'crumple' ? '攤開來看' : tv.state === 'fold' ? '打開來看' : '廢紙'}</b>
        <button type="button" className="btn small" data-close>
          放回去
        </button>
      </div>
      <div className="mcenter">
        <div ref={ref} />
      </div>
    </>
  );
}
