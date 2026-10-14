/**
 * 收藏：收到的信，還有撬下來的郵票和火漆，收在跟字紙冢同一種空間（依書桌：抽屜、金屬收納箱、桌斗）。
 * 收藏屬於收件信箱（GET /collection）。重看信的內容要用開信連結：這個瀏覽器開過的連結會記住。
 */
import type { CollectionDTO, ReceiveDTO } from '@manxin/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, recvAttachmentUrl } from '../api/client.ts';
import { envFrontHTML, paintZones, stampArt, type ViewPkg } from '../lib/art.ts';
import { mountSheet } from '../lib/paper.ts';
import { DESKS, knownTokens } from '../lib/prefs.ts';
import { fmt } from '../lib/time.ts';
import { $, hash } from '../lib/util.ts';
import { useApp } from '../state/app.tsx';
import { mountLetter, recvPkg, recvSheet, renderPieces } from './Receive.tsx';

type LetterItem = CollectionDTO['letters'][number] & { dto: ReceiveDTO | null; token: string | null };

/** 沒有開信連結時的樣子（原型 defaultPkg） */
function plainPkg(fromName: string, at: number): ViewPkg {
  return {
    env: 'kraft',
    stamp: 'plum',
    stampSrc: null,
    pm: 'date',
    pmSrc: null,
    skin: null,
    stampPos: { x: 0.87, y: 0.24, r: 3 },
    pmPos: { x: 0.77, y: 0.3, r: -10 },
    pmAt: at,
    folds: [],
    pack: null,
    rot: false,
    etxt: { from: { c: [...(fromName || '')], s: [] }, to: { c: [], s: [] } },
    efont: 'kai',
  };
}

export function CollectionPage() {
  const app = useApp();
  const { prefs, toast } = app;
  const [C, setC] = useState<CollectionDTO | null>(null);
  const [letters, setLetters] = useState<LetterItem[]>([]);
  const tokens = knownTokens();

  useEffect(() => {
    let alive = true;
    api
      .collection()
      .then(async (c) => {
        if (!alive) return;
        setC(c);
        const ls = await Promise.all(
          c.letters.map(async (l) => {
            const token = knownTokens()[l.no] ?? null;
            const dto = token ? await api.recv(token).catch(() => null) : null;
            return { ...l, token, dto };
          }),
        );
        if (alive) setLetters(ls);
      })
      .catch((e) => toast((e as Error).message));
    return () => {
      alive = false;
    };
  }, [toast, app.timeVersion]);

  if (!C) return <p className="hint">打開{DESKS[prefs.desk].coll}…</p>;
  const name = DESKS[prefs.desk].coll;
  return (
    <>
      <div className="tomb-head">
        <h2 className="h2">收藏・{name}</h2>
        <p className="hint">收到的信，還有撬下來的郵票和火漆，都收在這裡。</p>
      </div>
      <div className="section">
        <span className="label">收到的信・{C.letters.length} 封</span>
        <div className="tomb-grid" id="cLet">
          <span className="plaque">來信</span>
          {!C.letters.length && <p className="hint tray-empty">還沒有收藏的信。</p>}
          {letters.map((it) => (
            <CollLetter key={it.no} it={it} />
          ))}
        </div>
      </div>
      <div className="section" style={{ marginTop: 28 }}>
        <span className="label">
          郵票 {C.stamps.length} 枚・火漆 {C.waxes.length} 個
        </span>
        <div className="tomb-grid" id="cSt">
          <span className="plaque">小東西</span>
          {!C.stamps.length && !C.waxes.length && <p className="hint tray-empty">還沒有撬下來的郵票或火漆。</p>}
          {C.stamps.map((x) => {
            const tk = tokens[x.no];
            const src = x.stampAttachmentId && tk ? recvAttachmentUrl(tk, x.stampAttachmentId) : null;
            return (
              <div key={'s' + x.no} className="titem" style={{ ['--tilt' as string]: (hash(x.at + 's') % 11) - 5 + 'deg' }}>
                <div className={'cstamp' + (x.fiber ? ' fiber' : '')} dangerouslySetInnerHTML={{ __html: stampArt(x.stamp, src) }} />
                <span className="tag">
                  <i className="hole"></i>
                  <b>郵票</b>
                  <span>{x.fiber ? '黏著紙纖維' : x.fromName || ''}</span>
                </span>
              </div>
            );
          })}
          {C.waxes.map((x) => (
            <div key={'w' + x.no} className="titem">
              <div className={'cwax' + (x.fiber ? ' fiber' : '')}>{prefs.era === 'minguo' ? '緘' : '慢'}</div>
              <span className="tag">
                <i className="hole"></i>
                <b>火漆</b>
                <span>{x.fiber ? '黏著紙纖維' : x.fromName || ''}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CollLetter({ it }: { it: LetterItem }) {
  const { openModal, prefs } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const tilt = (hash(it.no) % 9) - 4;
  const pk = it.dto && it.token ? recvPkg(it.dto, it.token) : plainPkg(it.fromName, it.at);
  useLayoutEffect(() => {
    const o = ref.current;
    if (!o) return;
    o.innerHTML = envFrontHTML(pk, { office: it.dto?.office, t: it.dto?.sentAt ?? it.at, stampTaken: it.dto?.recv.stampTaken, stampFiber: it.dto?.recv.stampFiber });
    const sheet = it.dto && it.token ? recvSheet(it.dto, it.token) : null;
    if (pk.env === 'card' && sheet) {
      const card = $('.ev-card', o);
      if (card) mountSheet(card, sheet, 170, {});
    }
    requestAnimationFrame(() => paintZones(o, pk));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.dto, it.token]);

  const open = () =>
    openModal({
      content: (
        <>
          <div className="mhead">
            <b>{it.fromName || '某個人'}寄來的信</b>
            <button type="button" className="btn small" data-close>
              收回去
            </button>
          </div>
          <div className="mcenter">
            {it.dto && it.token ? <CollView dto={it.dto} token={it.token} era={prefs.era} /> : <p className="hint">這封信是在別的瀏覽器拆的。要再看一次，請用當初 email 裡的開信連結打開。</p>}
          </div>
        </>
      ),
    });

  return (
    <div className="titem" style={{ ['--tilt' as string]: tilt + 'deg' }}>
      <div
        className="cenv"
        role="button"
        tabIndex={0}
        ref={ref}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      />
      <span className="tag">
        <i className="hole"></i>
        <b>{it.fromName || '某個人'}</b>
        <span>
          {fmt(it.at, { time: false, wk: false })}
          {it.torn ? '・撕破了' : ''}
        </span>
      </span>
    </div>
  );
}

function CollView({ dto, token, era }: { dto: ReceiveDTO; token: string; era: 'minguo' | '80s' | 'doodle' }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (dto.recv.torn) renderPieces(v, dto, token, era);
    else {
      const sheet = recvSheet(dto, token);
      if (sheet) mountLetter(v, sheet, dto.pkg.folds, Math.min(520, innerWidth - 80));
    }
  }, [dto, token, era]);
  return <div ref={ref} className={dto.recv.torn ? 'rv-pieces' : undefined} style={dto.recv.torn ? { height: 620 } : undefined} />;
}
