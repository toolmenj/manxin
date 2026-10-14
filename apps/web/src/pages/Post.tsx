/**
 * 郵局：出發前（地圖選點、交通方式、郵筒顏色）→ 路上倒數（以伺服器時間校正）→ 走進郵局 → 櫃台。
 * 路程分鐘數與抵達時間都由後端算（POST /letters/:id/trip），前端只畫倒數。
 */
import type { LetterDTO, PlaceId, TravelMode } from '@manxin/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, isApiError, type PlacesDTO } from '../api/client.ts';
import { Empty, Html, SheetThumb } from '../components/common.tsx';
import { letterHas, loadCurrentLetter, ownSheet } from '../lib/letters.ts';
import { drawRoute, mapSVG, placeWalker } from '../lib/map.ts';
import { dur, fmt } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';
import { Counter } from './Counter.tsx';

export function PostPage() {
  const app = useApp();
  const nav = useNavigate();
  const [L, setL] = useState<LetterDTO | null | undefined>(undefined);
  const [places, setPlaces] = useState<PlacesDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cur, pl] = await Promise.all([loadCurrentLetter(app.prefs.era, false), api.places()]);
      setL(cur);
      setPlaces(pl);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load, app.timeVersion]);

  if (err)
    return (
      <Empty title="郵局沒開">
        <p>{err}</p>
        <button type="button" className="btn" onClick={() => void load()}>
          再試一次
        </button>
      </Empty>
    );
  if (L === undefined || !places) return <p className="hint">往郵局的路上…</p>;
  const T = L?.trip ?? null;
  if (!L || (!T && !letterHas(L)))
    return (
      <Empty title="書桌上還沒有信">
        <p>先寫點什麼，再來郵局。</p>
        <button type="button" className="btn primary" onClick={() => nav('/desk')}>
          回書桌
        </button>
      </Empty>
    );
  if (T && T.enteredAt) return <Counter letter={L} trip={T} onLetter={setL} reload={load} />;
  return <Trip L={L} places={places} onLetter={setL} />;
}

function Trip({ L, places, onLetter }: { L: LetterDTO; places: PlacesDTO; onLetter: (l: LetterDTO) => void }) {
  const app = useApp();
  const nav = useNavigate();
  const { prefs, setPrefs, toast } = app;
  const T = L.trip;
  const P = prefs.postSel;
  const sel = T ? T.place : P.place;
  const mapRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(app.now());
  const [busy, setBusy] = useState(false);

  // 地圖：路線一筆一筆畫出來；出發後腳印跟著走
  useLayoutEffect(() => {
    if (!mapRef.current) return;
    if (!T) drawRoute(mapRef.current);
  }, [sel, T]);

  useEffect(() => {
    if (!T) return;
    let raf = 0;
    const f = () => {
      const t = app.now();
      setNow(t);
      const g = Math.min(1, Math.max(0, (t - T.startAt) / (T.arriveAt - T.startAt)));
      if (mapRef.current) placeWalker(mapRef.current, g);
      if (g < 1) raf = requestAnimationFrame(f);
    };
    f();
    const i = setInterval(() => setNow(app.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(i);
    };
  }, [T, app]);

  const pl = places.places.find((p) => p.id === sel)!;
  const depart = async () => {
    if (L.refs.length) return;
    setBusy(true);
    try {
      const trip = await api.startTrip(L.id, { place: P.place, mode: P.mode, box: P.box });
      await app.syncTime();
      onLetter({ ...L, trip });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const goHome = async () => {
    try {
      await api.goHome(L.id);
      onLetter({ ...L, trip: null });
      toast('回家了。信還在書桌上。');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const goIn = async () => {
    setBusy(true);
    try {
      const r = await api.enter(L.id);
      // 第一次進櫃台：照年代風格擺好預設的信封和郵票（原型 counterInit）
      const c = r.counter;
      const pristine = !c.envLocked && !c.folds.length && !c.stampPos && !c.pmPos && !c.addrOk && c.env === 'post' && c.stamp === 'plum' && !c.stampAttachmentId;
      if (pristine) {
        const want: Parameters<typeof api.patchCounter>[1] = {};
        if (prefs.era === 'minguo') want.env = 'chinese';
        if (prefs.era === 'doodle') want.stamp = 'tear';
        else if (prefs.era === 'minguo') want.stamp = 'junk';
        if (Object.keys(want).length) await api.patchCounter(L.id, want).catch(() => undefined);
      }
      onLetter({ ...L, trip: r.trip });
    } catch (e) {
      if (isApiError(e, 'NOT_ARRIVED')) {
        await app.syncTime();
        toast('還沒走到郵局。再等一下。');
      } else toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const left = T ? T.arriveAt - now : 0;
  const prog = T ? Math.min(1, 1 - left / (T.arriveAt - T.startAt)) : 0;
  const modeLabel = (m: TravelMode) => places.modes[m]?.label ?? m;

  return (
    <div className="post-grid">
      <div className="col">
        <h2 className="h2">帶去郵局的東西</h2>
        <div className="carry">
          <SheetThumb sheet={ownSheet(L)} width={150} env={L.env} />
          <div className="carry-tx">
            <p>
              {L.sheet.kind === 'postcard' ? '明信片 1 張' : '信紙 1 張'}
              {L.attachments.length ? `、附件 ${L.attachments.length} 件` : ''}
            </p>
            <p className="hint">信封、郵票、郵戳到郵局再挑，地址也在郵局的櫃台填。</p>
          </div>
        </div>
        {L.refs.length > 0 && (
          <div className="alert">
            <p>桌邊還有 {L.refs.length} 張舊信紙沒處理。寄出前，先決定它們要進字紙冢還是垃圾桶。</p>
            <button type="button" className="btn small" onClick={() => nav('/desk')}>
              回書桌處理
            </button>
          </div>
        )}
      </div>
      <div className="col">
        <h2 className="h2">前往郵局</h2>
        <div ref={mapRef}>
          <Html className="map" html={mapSVG(places.places, sel, !!T)} key={sel + (T ? 'w' : '')} />
        </div>
        <div id="tripBox">
          {!T ? (
            <div className="col">
              <div className="places">
                {places.places.map((p) => (
                  <button key={p.id} type="button" className="place" data-pl={p.id} aria-pressed={p.id === P.place} onClick={() => setPrefs({ postSel: { ...P, place: p.id as PlaceId } })}>
                    <span className="dot"></span>
                    <span>
                      {p.name}
                      <small>{p.kind}</small>
                    </span>
                    <span className="d">{p.m >= 1000 ? (p.m / 1000).toFixed(1) + ' km' : p.m + ' m'}</span>
                  </button>
                ))}
              </div>
              <div className="opts">
                <div className="seg" id="mdSeg">
                  {(Object.keys(places.modes) as TravelMode[]).map((k) => (
                    <button key={k} type="button" data-v={k} aria-pressed={k === P.mode} onClick={() => setPrefs({ postSel: { ...P, mode: k } })}>
                      {modeLabel(k)}
                    </button>
                  ))}
                </div>
                <div className="seg" id="bxSeg">
                  <button type="button" data-v="green" aria-pressed={P.box === 'green'} onClick={() => setPrefs({ postSel: { ...P, box: 'green' } })}>
                    綠色郵筒・普通
                  </button>
                  <button type="button" data-v="red" aria-pressed={P.box === 'red'} onClick={() => setPrefs({ postSel: { ...P, box: 'red' } })}>
                    紅色郵筒・限時
                  </button>
                </div>
              </div>
              <p className="eta">
                {modeLabel(P.mode)}到{pl.name}約 <b>{pl.minutes[P.mode]} 分鐘</b>。出發後要真的等這段時間，到了才能進郵局。
              </p>
              <div>
                <button type="button" className="btn primary" id="goBtn" disabled={!!L.refs.length || busy} onClick={() => void depart()}>
                  帶著信出發
                </button>
              </div>
            </div>
          ) : left > 0 ? (
            <div className="trip">
              <span className="label">
                {modeLabel(T.mode)}前往 {T.placeName}
              </span>
              <div className="countdown" id="cd">
                {dur(left)}
              </div>
              <div className="bar">
                <i id="cdBar" style={{ width: (Math.max(0, prog) * 100).toFixed(1) + '%' }}></i>
              </div>
              <p className="hint">預計 {fmt(T.arriveAt)} 抵達。可以關掉頁面，時間到了再回來。</p>
              <div>
                <button type="button" className="btn ghost" id="backHome" onClick={() => void goHome()}>
                  掉頭回家
                </button>
              </div>
            </div>
          ) : (
            <div className="trip">
              <span className="label">已抵達</span>
              <p style={{ margin: 0, font: '700 22px var(--hand)' }}>你到了{T.placeName}。</p>
              <div>
                <button type="button" className="btn primary" id="goIn" disabled={busy} onClick={() => void goIn()}>
                  走進郵局
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
