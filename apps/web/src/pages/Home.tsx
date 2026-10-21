/**
 * 首頁：標語、跟 email 哪裡不同、一封信會經過的四站、你的信、換個樣子。
 */
import type { LetterDTO, SheetDTO } from '@manxin/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { SheetThumb } from '../components/common.tsx';
import { envFrontHTML, paintZones, type ViewPkg } from '../lib/art.ts';
import { letterHas, loadCurrentLetter, ownSheet } from '../lib/letters.ts';
import { viewSheet } from '../lib/paper.ts';
import { DESK_SW, DESKS, ERA_INFO, type DeskKind } from '../lib/prefs.ts';
import type { Era } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';

const BLANK: SheetDTO = { id: 'blank', kind: 'letter', style: 'lined', mode: 'type', font: 'typewriter', fontUrl: null, bgAttachmentId: null, bgTemplate: null, seq: 0, chars: [], strokes: [], scan: null, createdAt: 0 };

export function HomePage() {
  const app = useApp();
  const nav = useNavigate();
  const { prefs, counts, user } = app;
  const [L, setL] = useState<LetterDTO | null>(null);
  const [inT, setInT] = useState(0);
  const [tomb, setTomb] = useState<{ unsent: number; sheets: number }>({ unsent: 0, sheets: 0 });
  const envRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    loadCurrentLetter(prefs.era, false)
      .then(setL)
      .catch(() => undefined);
    api
      .shipments()
      .then((r) => setInT(r.shipments.filter((s) => s.state === 'transit').length))
      .catch(() => undefined);
    api
      .tomb()
      .then((t) => setTomb({ unsent: t.unsent.length, sheets: t.sheets.length }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, app.timeVersion]);

  useLayoutEffect(() => {
    const he = envRef.current;
    if (!he) return;
    const era = prefs.era;
    const pk: ViewPkg = {
      env: era === 'minguo' ? 'chinese' : 'post',
      stamp: era === 'doodle' ? 'tear' : era === 'minguo' ? 'junk' : 'plum',
      stampSrc: null,
      pm: 'date',
      pmSrc: null,
      skin: null,
      stampPos: { x: era === 'minguo' ? 0.24 : 0.86, y: era === 'minguo' ? 0.12 : 0.24, r: 4 },
      pmPos: { x: era === 'minguo' ? 0.36 : 0.75, y: era === 'minguo' ? 0.2 : 0.32, r: -12 },
      pmAt: app.now(),
      etxt: { from: { c: [], s: [] }, to: { c: [...'給 那個人'], s: [] } },
      efont: 'kai',
      folds: [],
      pack: null,
      rot: false,
    };
    he.innerHTML = envFrontHTML(pk, { office: '慢信郵局', t: app.now() });
    he.classList.toggle('v', pk.env === 'chinese');
    paintZones(he, pk);
  }, [prefs.era, app]);

  const has = L ? letterHas(L) : false;
  const toOpen = counts.inbox;
  const deskNote = !user
    ? '登入之後，你的書桌會在這裡。'
    : L?.trip
      ? '信在你身上，正往郵局去。'
      : has
        ? `書桌上有一封寫了 ${L!.sheet.chars.filter((o) => o.c.trim()).length} 個字的信。`
        : '書桌上還沒有信。';
  const sheet = L && L.sheet.chars.length ? ownSheet(L) : viewSheet(L?.sheet ?? BLANK, () => '');

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-tx">
          <p className="hero-k">一封信，要走一段路</p>
          <h1 className="hero-h">
            從前慢，
            <br />
            如今也慢。
          </h1>
          <p className="hero-p">有些話不敢當面說，也不想用訊息一下子丟出去。在這裡，你一個字一個字寫好，自己走去郵局寄，信會在路上走好幾天，收信的人要親手把它拆開。</p>
          <div className="hero-cta">
            <button type="button" className="btn primary big" onClick={() => nav(user ? '/desk' : '/login')}>
              {has ? '回書桌接著寫' : '開始寫信'}
            </button>
            <button type="button" className="btn" onClick={() => nav('/inbox')}>
              看看信箱{toOpen ? `（${toOpen} 封沒拆）` : ''}
            </button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <SheetThumb sheet={sheet} width={220} env={{}} className="ha-sheet" />
          <div className="ha-env" id="haEnv" ref={envRef}></div>
        </div>
      </section>
      <section className="home-flow">
        <h2 className="h2">一封信會經過的四站</h2>
        <ol className="flow">
          <li>
            <span className="fl-n">一</span>
            <b>在書桌寫</b>
            <span>沒有復原、沒有刪除、沒有橡皮擦。寫錯就劃掉，痕跡留著；真的不行，就謄一張新的。</span>
          </li>
          <li>
            <span className="fl-n">二</span>
            <b>走去郵局</b>
            <span>挑一間郵局或郵筒，用走的、騎車或開車。路程要真的等完，才進得了郵局。</span>
          </li>
          <li>
            <span className="fl-n">三</span>
            <b>信在路上</b>
            <span>從最近一班車出發，下雨、颱風、週末和國定假日都會讓它晚一點到。</span>
          </li>
          <li>
            <span className="fl-n">四</span>
            <b>親手拆開</b>
            <span>收信的人用開信刀或用手撕。拆得太粗魯，信會裂成兩半，只能自己拼回去。</span>
          </li>
        </ol>
      </section>
      <section className="home-now">
        <h2 className="h2">你的信</h2>
        <div className="now-grid">
          <button type="button" className="panel now" onClick={() => nav('/desk')}>
            <span className="label">書桌</span>
            <b>{deskNote}</b>
          </button>
          <button type="button" className="panel now" onClick={() => nav('/track')}>
            <span className="label">追蹤</span>
            <b>{inT ? `${inT} 封信在路上。` : '目前沒有信在路上。'}</b>
          </button>
          <button type="button" className="panel now" onClick={() => nav('/inbox')}>
            <span className="label">收信</span>
            <b>{toOpen ? `有 ${toOpen} 封信等你拆。` : '信箱裡沒有沒拆的信。'}</b>
          </button>
          <button type="button" className="panel now" onClick={() => nav('/tomb')}>
            <span className="label">字紙冢</span>
            <b>
              {tomb.unsent} 封沒寄出的信、{tomb.sheets} 張廢紙。
            </b>
          </button>
        </div>
      </section>
      <section className="home-pick">
        <h2 className="h2">換個樣子</h2>
        <div className="pick-row">
          <span className="label">年代</span>
          {(Object.entries(ERA_INFO) as [Era, (typeof ERA_INFO)['80s']][]).map(([k, [n, d, a, b, c]]) => (
            <button key={k} type="button" className="pick" data-era={k} aria-pressed={prefs.era === k} onClick={() => void app.switchEra(k)}>
              <span className="sw" style={{ background: `linear-gradient(135deg,${c} 0 45%,${a} 45% 72%,${b} 72%)` }}></span>
              <b>{n}</b>
              <small>{d}</small>
            </button>
          ))}
        </div>
        <div className="pick-row">
          <span className="label">書桌</span>
          {(Object.entries(DESKS) as [DeskKind, (typeof DESKS)['wood']][]).map(([k, v]) => (
            <button key={k} type="button" className="pick" data-desk={k} aria-pressed={prefs.desk === k} onClick={() => app.setPrefs({ desk: k })}>
              <span className="sw" style={{ background: DESK_SW[k] }}></span>
              <b>{v.label}</b>
              <small>字紙冢是{v.tomb}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
