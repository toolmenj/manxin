/**
 * 收信：收件人的信箱（D-024）。
 * 用收到信的那個信箱登入，就看得到所有寄給你、已經送達的信（GET /inbox），換瀏覽器也找得到。
 * 另外補上這個瀏覽器開過、但不是寄給目前登入信箱的開信連結。
 */
import type { InboxItemDTO } from '@manxin/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { Empty } from '../components/common.tsx';
import { knownTokens } from '../lib/prefs.ts';
import { fmt } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';

interface Item {
  token: string;
  no: string;
  opened: boolean;
  fromName: string;
  postcard: boolean;
  office: string;
  sentAt: number;
  /** true：寄給目前登入的信箱；false：這個瀏覽器開過的別的連結 */
  mine: boolean;
}

const tokenOf = (link: string) => link.replace(/^\/r\//, '');

function useInbox(): Item[] | null {
  const app = useApp();
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const box: InboxItemDTO[] = app.user ? await api.inbox().then((r) => r.letters).catch(() => []) : [];
      const out: Item[] = box.map((l) => ({
        token: tokenOf(l.link),
        no: l.no,
        opened: l.opened,
        fromName: l.fromName,
        postcard: l.postcard,
        office: '',
        sentAt: l.sentAt,
        mine: true,
      }));
      const seen = new Set(out.map((x) => x.no));
      await Promise.all(
        Object.entries(knownTokens())
          .filter(([no]) => !seen.has(no))
          .map(async ([no, token]) => {
            try {
              const r = await api.recv(token);
              out.push({ token, no, opened: r.recv.opened, fromName: r.fromName, postcard: r.pkg.env === 'card', office: r.office, sentAt: r.sentAt, mine: false });
            } catch {
              /* 連結失效（改寄、退回）就不列 */
            }
          }),
      );
      out.sort((a, b) => b.sentAt - a.sentAt);
      if (alive) setItems(out);
    })();
    return () => {
      alive = false;
    };
  }, [app.user, app.timeVersion]);
  return items;
}

function Row({ x, pressed, onClick }: { x: Item; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="ship" data-rv={x.no} aria-pressed={pressed} onClick={onClick}>
      <span className="row">
        <b>【慢信】{x.fromName || '有人'}給你寄了一封{x.postcard ? '明信片' : '信'}</b>
      </span>
      <span className="row">
        <span>{x.mine ? '寄到你的信箱' : '這個瀏覽器開過的連結'}</span>
        <span className={'chip ' + (x.opened ? 'ok' : 'warn')}>{x.opened ? '已開信' : '還沒開'}</span>
      </span>
      <span className="row">
        <span>{fmt(x.sentAt, { time: false })} 寄出</span>
      </span>
    </button>
  );
}

export function InboxList({ current }: { current?: string }) {
  const nav = useNavigate();
  const items = useInbox();
  if (!items || !items.length) return <div className="col" />;
  return (
    <div className="col">
      <span className="label">你的信箱</span>
      <div className="ships">
        {items.map((x) => (
          <Row key={x.token} x={x} pressed={x.token === current} onClick={() => nav('/r/' + x.token)} />
        ))}
      </div>
    </div>
  );
}

export function InboxPage() {
  const app = useApp();
  const nav = useNavigate();
  const items = useInbox();
  const [sel, setSel] = useState<string | null>(null);
  if (!items) return <p className="hint">打開信箱…</p>;
  if (!items.length)
    return (
      <Empty title="信箱裡還沒有信">
        <p>
          寄給 {app.user?.email ?? '你'} 的信送到以後，會出現在這裡，也會寄一封通知到你的電子信箱。
          {app.devOffset !== null && ' 開發時可以用右上角的「快轉」讓時間往前走。'}
        </p>
      </Empty>
    );
  const s = items.find((x) => x.token === sel) ?? items[0]!;
  return (
    <div className="track-grid">
      <div className="col">
        <span className="label">你的信箱</span>
        <div className="ships">
          {items.map((x) => (
            <Row key={x.token} x={x} pressed={x.token === s.token} onClick={() => setSel(x.token)} />
          ))}
        </div>
      </div>
      <div className="detail" id="rvDetail">
        <div className="mailbody panel">
          <h3>有人給你寄了一封{s.postcard ? '明信片' : '信'}</h3>
          <p>
            {s.fromName || '有個人'}寫了一封{s.postcard ? '明信片' : '信'}給你，{fmt(s.sentAt, { time: false })}
            {s.office ? `從${s.office}` : ''}寄出，現在送到了。
          </p>
          <p>信不會自己打開。點下面的按鈕，親手拆開它。</p>
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
