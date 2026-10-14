/**
 * 收信：收件人的電子信箱。正式環境裡，收件人是從 email 的開信連結（/r/:token）進來的；
 * 開發環境沒有真的寄信，所以這裡從本機信箱（GET /dev/outbox）找出寄給你的開信通知，
 * 再加上這個瀏覽器開過的開信連結。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { Empty } from '../components/common.tsx';
import { knownTokens } from '../lib/prefs.ts';
import { fmt } from '../lib/time.ts';
import { deliveryLinks, useApp, type DeliveryLink } from '../state/app.tsx';

interface Item extends DeliveryLink {
  opened: boolean | null;
  fromName: string;
  postcard: boolean;
  office: string;
  sentAt: number;
}

function useInbox(): Item[] | null {
  const app = useApp();
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const links = app.user ? await deliveryLinks(app.user.email).catch(() => []) : [];
      const seen = new Set(links.map((l) => l.no));
      for (const [no, token] of Object.entries(knownTokens())) if (!seen.has(no)) links.push({ token, no, to: '', at: 0, subject: '', text: '' });
      const out: Item[] = [];
      await Promise.all(
        links.map(async (l) => {
          try {
            const r = await api.recv(l.token);
            out.push({ ...l, opened: r.recv.opened, fromName: r.fromName, postcard: r.pkg.env === 'card', office: r.office, sentAt: r.sentAt });
          } catch {
            /* 連結失效（改寄、退回）就不列 */
          }
        }),
      );
      out.sort((a, b) => b.at - a.at || b.sentAt - a.sentAt);
      if (alive) setItems(out);
    })();
    return () => {
      alive = false;
    };
  }, [app.user, app.timeVersion]);
  return items;
}

export function InboxList({ current }: { current?: string }) {
  const nav = useNavigate();
  const items = useInbox();
  if (!items || !items.length) return <div className="col" />;
  return (
    <div className="col">
      <span className="label">收件人的電子信箱</span>
      <div className="ships">
        {items.map((x) => (
          <button key={x.token} type="button" className="ship" data-rv={x.no} aria-pressed={x.token === current} onClick={() => nav('/r/' + x.token)}>
            <span className="row">
              <b>【慢信】有人給你寄了一封信</b>
            </span>
            <span className="row">
              <span>{x.to ? `寄到 ${x.to}` : '這個瀏覽器開過的連結'}</span>
              <span className={'chip ' + (x.opened ? 'ok' : 'warn')}>{x.opened ? '已開信' : '還沒開'}</span>
            </span>
            {x.at > 0 && (
              <span className="row">
                <span>{fmt(x.at)}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="hint">正式版會真的寄 email 到收件人信箱，信裡附開信的連結。開發環境的信在「本機信箱」。</p>
    </div>
  );
}

export function InboxPage() {
  const nav = useNavigate();
  const items = useInbox();
  const [sel, setSel] = useState<string | null>(null);
  if (!items) return <p className="hint">打開信箱…</p>;
  if (!items.length)
    return (
      <Empty title="信箱裡還沒有信">
        <p>信送到你的電子信箱以後，會出現在這裡。開發時可以用右上角的「快轉」讓時間往前走，再到「本機信箱」看開信通知。</p>
      </Empty>
    );
  const s = items.find((x) => x.token === sel) ?? items[0]!;
  return (
    <div className="track-grid">
      <div className="col">
        <span className="label">收件人的電子信箱</span>
        <div className="ships">
          {items.map((x) => (
            <button key={x.token} type="button" className="ship" data-rv={x.no} aria-pressed={x.token === s.token} onClick={() => setSel(x.token)}>
              <span className="row">
                <b>【慢信】有人給你寄了一封信</b>
              </span>
              <span className="row">
                <span>{x.to ? `寄到 ${x.to}` : '這個瀏覽器開過的連結'}</span>
                <span className={'chip ' + (x.opened ? 'ok' : 'warn')}>{x.opened ? '已開信' : '還沒開'}</span>
              </span>
              {x.at > 0 && (
                <span className="row">
                  <span>{fmt(x.at)}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="hint">正式版會真的寄 email 到收件人信箱，信裡附開信的連結。開發環境的信在「本機信箱」。</p>
      </div>
      <div className="detail" id="rvDetail">
        <div className="mailbody panel">
          <p className="hint">寄件人：慢信 &lt;letters@manxin.example&gt;</p>
          <h3>有人給你寄了一封信</h3>
          <p>
            {s.fromName || '有個人'}寫了一封{s.postcard ? '明信片' : '信'}給你，{fmt(s.sentAt, { time: false })}從{s.office}寄出，現在送到了。
          </p>
          <p>信不會自己打開。點下面的連結，親手拆開它。</p>
          <div>
            <button type="button" className="btn primary" id="rvEnter" onClick={() => nav('/r/' + s.token)}>
              打開連結
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
