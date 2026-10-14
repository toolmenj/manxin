/**
 * 本機信箱（開發用）：列出後端 ConsoleMailer「寄出」的信（GET /dev/outbox）。
 * 登入信、開信通知、提醒、退信、30 天詢問都在這裡，信裡的連結可以直接點。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type OutboxMail } from '../api/client.ts';
import { fmt } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';

/** 把信裡指向前端的網址換成站內連結 */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (!/^https?:\/\//.test(p)) return <span key={i}>{p}</span>;
    let path = p;
    try {
      const u = new URL(p);
      path = u.pathname + u.search;
    } catch {
      /* 不是網址 */
    }
    return (
      <Link key={i} to={path} className="mail-link">
        {p}
      </Link>
    );
  });
}

export function MailboxPage() {
  const app = useApp();
  const [sp, setSp] = useSearchParams();
  const to = sp.get('to') ?? '';
  const [q, setQ] = useState(to);
  const [mails, setMails] = useState<OutboxMail[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.dev.outbox(to || undefined, 200);
      setMails(r.mails);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [to]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load, app.timeVersion]);

  return (
    <div className="mailbox">
      <div className="tomb-head">
        <h2 className="h2">本機信箱（開發用）</h2>
        <p className="hint">開發階段不會真的寄 email（D-002）。後端「寄出」的信都在這裡：登入連結、開信通知、提醒、退信、30 天詢問。每 5 秒自動更新。</p>
      </div>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSp(q.trim() ? { to: q.trim() } : {});
        }}
      >
        <input placeholder="只看寄給某個信箱的信" aria-label="收件信箱" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn">
          篩選
        </button>
        {app.user && (
          <button type="button" className="btn ghost" onClick={() => (setQ(app.user!.email), setSp({ to: app.user!.email }))}>
            只看我的
          </button>
        )}
      </form>
      {err && <p className="hint">{err}（正式環境沒有本機信箱。）</p>}
      <div className="inbox" style={{ marginTop: 14 }}>
        {mails && !mails.length && <p className="hint">還沒有信。</p>}
        {mails?.map((m) => (
          <div key={m.id} className="mail" data-kind={m.meta?.kind}>
            <span className="m">
              {fmt(m.createdAt)}・寄給 {m.to}
            </span>
            <span className="s">{m.subject}</span>
            <span className="mail-text">{linkify(m.text)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
