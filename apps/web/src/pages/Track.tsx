/**
 * 追蹤：單號查詢、時間軸、計算明細、改收件信箱、退件郵戳。
 * 狀態、事件、送達時間、可改次數全部用後端回傳的結果；前端不重算。
 * 沒登入（或不是自己寄的）時，用公開查詢 GET /track/:no，信箱會遮起來。
 */
import type { ShipState, ShipmentDTO, TrackDTO } from '@manxin/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, attachmentUrl, isApiError, type OutboxMail } from '../api/client.ts';
import { Empty, Html, SheetThumb } from '../components/common.tsx';
import { returnPostmarkSVG } from '../lib/art.ts';
import { viewSheet, type ViewSheet } from '../lib/paper.ts';
import { fmt, hrs } from '../lib/time.ts';
import { hash, okMail, spaced } from '../lib/util.ts';
import { deliveryLinks, useApp } from '../state/app.tsx';

export const STATE: Record<ShipState, [string, string]> = {
  transit: ['運送中', 'go'],
  rerouting: ['改寄中', 'go'],
  waiting: ['已送達・未簽收', 'warn'],
  signed: ['已簽收', 'ok'],
  returned: ['已退回', 'bad'],
};

export function TrackPage() {
  const app = useApp();
  const nav = useNavigate();
  const { no: paramNo } = useParams();
  const [ships, setShips] = useState<ShipmentDTO[] | null>(null);
  const [pub, setPub] = useState<TrackDTO | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (app.user) {
      try {
        setShips((await api.shipments()).shipments);
      } catch (e) {
        setErr((e as Error).message);
      }
    } else setShips([]);
  }, [app.user]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load, app.timeVersion]);

  // 網址上的單號不是自己寄的：用公開查詢
  useEffect(() => {
    if (!paramNo || !ships) return;
    const no = paramNo.toUpperCase();
    if (ships.some((s) => s.no === no)) {
      setPub(null);
      return;
    }
    api
      .track(no)
      .then(setPub)
      .catch((e) => {
        setPub(null);
        app.toast(isApiError(e, 'NOT_FOUND') ? '查無此單號。' : (e as Error).message);
      });
  }, [paramNo, ships, app.timeVersion, app]);

  const search = () => {
    const v = q.replace(/\s/g, '').toUpperCase();
    if (!v) return;
    nav('/track/' + v);
  };

  if (err) return <Empty title="查不到">{err}</Empty>;
  if (!ships) return <p className="hint">查詢中…</p>;
  if (!ships.length && !pub && !paramNo && app.user)
    return (
      <Empty title="還沒寄過信">
        <button type="button" className="btn primary" onClick={() => nav('/desk')}>
          去書桌
        </button>
      </Empty>
    );

  const sel = (paramNo && ships.find((s) => s.no === paramNo.toUpperCase())) || (!pub ? ships[0] : undefined);

  return (
    <div className="track-grid">
      <div className="col">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input id="q" placeholder="輸入單號，例如 RR12345678 9TW" aria-label="查詢單號" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="btn" id="qBtn">
            查詢
          </button>
        </form>
        <div className="ships">
          {ships.map((s) => {
            const [l, c] = STATE[s.state];
            return (
              <button key={s.no} type="button" className="ship" data-no={s.no} aria-pressed={sel?.no === s.no} onClick={() => nav('/track/' + s.no)}>
                <span className="row">
                  <span className="no">{spaced(s.no)}</span>
                </span>
                <span className="row">
                  <span>給 {s.env.toName || s.env.toEmail}</span>
                  <span className={'chip ' + c}>{l}</span>
                </span>
              </button>
            );
          })}
          {!app.user && <p className="hint">登入後，這裡會列出你寄過的信。沒登入也可以用單號查詢（信箱會遮起來）。</p>}
        </div>
      </div>
      {sel ? <ShipDetail key={sel.no} ship={sel} onShip={(s) => setShips((x) => x?.map((y) => (y.no === s.no ? s : y)) ?? null)} /> : pub ? <PublicDetail t={pub} /> : <div className="detail" />}
    </div>
  );
}

function Route({ stops, reached, state }: { stops: string[]; reached: number; state: ShipState }) {
  return (
    <div className="route">
      <ol>
        {stops.map((s, i) => (
          <li key={i} className={`${i <= reached ? 'done' : ''} ${i === Math.min(reached, stops.length - 1) && state === 'transit' ? 'now' : ''}`}>
            <span className="p"></span>
            <span>{s}</span>
          </li>
        ))}
        <li className={state !== 'transit' ? 'done' : ''}>
          <span className="p"></span>
          <span>收件人信箱</span>
        </li>
      </ol>
    </div>
  );
}

function Timeline({ events }: { events: TrackDTO['events'] }) {
  return (
    <div className="section">
      <span className="label">物流紀錄</span>
      <ul className="tl">
        {events.map((e, i) => (
          <li key={i} className={e.k || ''}>
            <time>{fmt(e.t)}</time>
            <div>
              <div className="tx">{e.tx}</div>
              <div className="pl">{e.pl}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PublicDetail({ t }: { t: TrackDTO }) {
  const [lab, cls] = STATE[t.state];
  return (
    <div className="detail">
      <div className="dhead">
        <div>
          <span className="label">虛擬快遞單號</span>
          <div className="bigno">{spaced(t.no)}</div>
        </div>
        <span className={'chip ' + cls}>{lab}</span>
      </div>
      <p className="hint">公開查詢：信箱已遮起來。寄件人登入後可以看完整資料、改收件信箱。</p>
      <Route stops={t.stops} reached={t.reached} state={t.state} />
      <Timeline events={t.events} />
    </div>
  );
}

function ShipDetail({ ship, onShip }: { ship: ShipmentDTO; onShip: (s: ShipmentDTO) => void }) {
  const app = useApp();
  const nav = useNavigate();
  const { toast, openModal } = app;
  const [newMail, setNewMail] = useState(ship.curEmail);
  const [mails, setMails] = useState<OutboxMail[] | null>(null);
  const [recvLink, setRecvLink] = useState<string | null>(null);
  const st = ship.state;
  const [lab, cls] = STATE[st];

  // 開發環境：寄件人信箱裡跟這張單號有關的通知、收件人的開信連結
  useEffect(() => {
    api.dev
      .outbox(ship.env.fromEmail, 200)
      .then((r) => setMails(r.mails.filter((m) => m.meta?.no === ship.no && m.meta?.kind !== 'deliver')))
      .catch(() => setMails(null));
    if (st === 'waiting')
      deliveryLinks(ship.curEmail)
        .then((ls) => setRecvLink(ls.find((l) => l.no === ship.no)?.token ?? null))
        .catch(() => setRecvLink(null));
  }, [ship.no, ship.env.fromEmail, ship.curEmail, st, app.timeVersion]);

  const showLetter = async () => {
    try {
      const L = await api.getLetter(ship.letterId);
      const vs: ViewSheet = viewSheet(L.sheet, attachmentUrl);
      const W = Math.min(560, innerWidth - 80);
      openModal({
        content: (
          <>
            <div className="mhead">
              <b>寄出的信（寄件人副本）</b>
              <button type="button" className="btn small" data-close>
                關閉
              </button>
            </div>
            <div className="mcenter">
              <SheetThumb sheet={vs} width={W} env={ship.env} />
            </div>
            {L.attachments.length > 0 && (
              <div className="atts">
                {L.attachments.map((a) => (
                  <div key={a.id} className="att" style={{ ['--r' as string]: (hash(a.id) % 9) - 4 + 'deg' }}>
                    <span className="clip"></span>
                    <img src={attachmentUrl(a.id)} alt="附件照片" />
                  </div>
                ))}
              </div>
            )}
          </>
        ),
      });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const edit = async () => {
    const v = newMail.trim();
    if (!okMail(v)) {
      toast('信箱格式不對，像 name@example.com 這樣。');
      return;
    }
    if (v === ship.curEmail) {
      toast('跟原本的信箱一樣。');
      return;
    }
    try {
      const s = await api.editRecipientEmail(ship.no, v);
      onShip(s);
      toast('改好了，會重新投遞到 ' + v);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const remindLast = ship.events.some((e) => e.tx.startsWith('送達 48 小時無人簽收'));

  return (
    <div className="detail">
      <div className="dhead">
        <div>
          <span className="label">虛擬快遞單號</span>
          <div className="bigno">{spaced(ship.no)}</div>
        </div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={'chip ' + cls}>{lab}</span>
          <button
            type="button"
            className="btn small"
            id="cpNo"
            onClick={() =>
              navigator.clipboard?.writeText(ship.no).then(
                () => toast('單號已複製。'),
                () => toast('沒辦法自動複製，請手動選取：' + ship.no),
              ) ?? toast('沒辦法自動複製，請手動選取：' + ship.no)
            }
          >
            複製單號
          </button>
          <button type="button" className="btn small" id="viewL" onClick={() => void showLetter()}>
            看信
          </button>
        </span>
      </div>
      <div className="kv">
        <div>
          <span className="label">交寄</span>
          <b>{fmt(ship.sentAt)}</b>
        </div>
        <div>
          <span className="label">{ship.deliverAt ? '送達' : '預計送達'}</span>
          <b>{ship.deliverAt ? fmt(ship.deliverAt) : '送達前不透露'}</b>
        </div>
        <div>
          <span className="label">寄件人</span>
          <span>
            {ship.env.fromName || ''} {ship.env.fromEmail}
          </span>
        </div>
        <div>
          <span className="label">收件人</span>
          <span>
            {ship.env.toName || ''} {ship.curEmail}
          </span>
        </div>
      </div>
      <Route stops={ship.stops} reached={ship.reached} state={st} />
      {st === 'returned' && ship.returnPostmark && (
        <div className="returned">
          <div className="mini-env">
            <Html className="pm" html={returnPostmarkSVG(ship.returnPostmark, ship.no)} />
            <span style={{ fontSize: 12, opacity: 0.75 }}>退回</span>
            <span>{ship.env.fromName || ship.env.fromEmail} 收</span>
          </div>
          <p className="hint" style={{ maxWidth: '36ch' }}>
            郵戳依目的地「{ship.returnPostmark.place}」產生，日期用民國紀年。不同目的地的郵戳形狀和墨色不一樣。
          </p>
        </div>
      )}
      {(st === 'waiting' || st === 'rerouting') && (
        <div className="section">
          <div className="editbox">
            {st === 'waiting' ? (
              recvLink ? (
                <button type="button" className="btn" id="signBtn" onClick={() => nav('/r/' + recvLink)}>
                  到收件人的信箱看看
                </button>
              ) : (
                <span className="hint">已經投遞到收件人信箱，等對方親手拆開。</span>
              )
            ) : (
              <span className="hint">改寄中，{fmt(ship.curDeliver)} 重新投遞。</span>
            )}
          </div>
          {ship.editsLeft > 0 && (
            <div className="editbox">
              <input id="newMail" type="email" placeholder="正確的收件信箱" value={newMail} onChange={(e) => setNewMail(e.target.value)} />
              <button type="button" className="btn primary" id="editBtn" onClick={() => void edit()}>
                修改並重新投遞
              </button>
              <span className="hint">
                剩 {ship.editsLeft} 次{remindLast ? '，這是最後一次' : ''}
              </span>
            </div>
          )}
        </div>
      )}
      <Timeline events={ship.events} />
      <div className="section">
        <span className="label">寄件人信箱{mails ? '（本機信箱，開發用）' : ''}</span>
        <div className="inbox">
          {mails && mails.length ? (
            mails.map((m) => (
              <div key={m.id} className="mail">
                <span className="m">
                  {fmt(m.createdAt)}・寄給 {m.to}
                </span>
                <span className="s">{m.subject}</span>
                <span>{m.text.split('\n')[0]}</span>
              </div>
            ))
          ) : (
            <p className="hint">{mails ? '目前沒有通知。' : `提醒和退信會寄到 ${ship.env.fromEmail}。`}</p>
          )}
        </div>
      </div>
      <div className="calc">
        <b style={{ fontFamily: 'var(--ui)' }}>送達時間怎麼算的</b>
        {ship.calc ? (
          <ol>
            <li>
              交寄後最近的發車班次：<b>{fmt(ship.calc.start)}</b>（每日 12:00／15:00／18:00，週末與國定假日不發車）
            </li>
            <li>
              基礎時間：<b>{ship.calc.base} 天</b>（{ship.calc.baseWhy}）
            </li>
            <li>
              延遲：隨機 <b>{hrs(ship.calc.randDelay)}</b>，天氣 <b>{hrs(ship.calc.wDelay)}</b>
            </li>
            <li>
              原始到達 <b>{fmt(ship.calc.raw)}</b>
              {ship.calc.raw !== ship.calc.deliver ? (
                <>
                  ，碰上下班或休假，順延到 <b>{fmt(ship.calc.deliver)}</b>
                </>
              ) : (
                '，在上班時間內'
              )}
            </li>
          </ol>
        ) : (
          <ol>
            <li>從交寄後最近的一班車出發（每日 12:00／15:00／18:00，週末與國定假日不發車）。</li>
            <li>基礎天數看兩地距離；再加上 48 小時內的隨機延遲和天氣。下班不送，順延到下一個工作天。</li>
            <li>信還在路上。送達之後，這裡會列出實際怎麼算的。</li>
          </ol>
        )}
      </div>
    </div>
  );
}
