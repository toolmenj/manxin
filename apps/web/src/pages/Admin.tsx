/**
 * 管理頁（只有 ADMIN_EMAILS 裡的信箱看得到）。
 * 依使用者決定：只有數字與狀態，看不到信件內容；信箱只顯示遮掉一半的版本。
 * 服務狀態、log、資源用量請看 KubeSphere；原始資料請走 pgAdmin（只能從叢集內部連）。
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type AdminFailures, type AdminReport, type AdminStats } from '../api/client.ts';
import { Empty } from '../components/common.tsx';
import { fmt } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';

const LETTER = { drafting: '書桌上', shelved: '先放著', sent: '已寄出' } as Record<string, string>;
const JOB = { pending: '待執行', done: '完成', skipped: '略過', failed: '失敗' } as Record<string, string>;
const MAIL = { pending: '待寄', sending: '寄送中', sent: '已寄出', failed: '放棄' } as Record<string, string>;
const KIND = {
  deliver: '送達通知',
  remind24: '24 小時提醒',
  remind48: '48 小時提醒',
  return30: '30 天退信',
  unsent_ask: '抽屜詢問',
  login: '登入信',
  return: '退信通知',
} as Record<string, string>;

const REASON = { harass: '騷擾、糾纏', threat: '威脅、恐嚇', spam: '廣告、詐騙', other: '其他' } as Record<string, string>;
const STATUS = { open: '待處理', dismissed: '不成立', suspended: '已停權' } as Record<string, string>;

const mb = (b: number) => (b / 1024 / 1024).toFixed(1) + ' MB';

function Tile({ label, value, note, warn }: { label: string; value: string | number; note?: string; warn?: boolean }) {
  return (
    <div className="panel" style={{ padding: '12px 16px', minWidth: 150 }}>
      <div className="hint">{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: warn ? 'var(--red, #B03A2E)' : undefined }}>{value}</div>
      {note && <div className="hint">{note}</div>}
    </div>
  );
}

function Counts({ title, data, names }: { title: string; data: Record<string, number>; names: Record<string, string> }) {
  const keys = Object.keys(data);
  return (
    <div className="section">
      <span className="label">{title}</span>
      <p>{keys.length ? keys.map((k) => `${names[k] ?? k} ${data[k]}`).join('・') : '沒有資料'}</p>
    </div>
  );
}

export function AdminPage() {
  const app = useApp();
  const [s, setS] = useState<AdminStats | null>(null);
  const [f, setF] = useState<AdminFailures | null>(null);
  const [rp, setRp] = useState<AdminReport[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([api.admin.stats(), api.admin.failures(), api.admin.reports()]);
      setS(a);
      setF(b);
      setRp(c.reports);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!app.admin) return;
    void load();
    // 分頁在背景時不更新（review M14）
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => clearInterval(t);
  }, [app.admin, load]);

  if (!app.admin) return <Empty title="這裡什麼都沒有" />;
  if (err) return <p className="hint">讀不到管理資料：{err}</p>;
  if (!s || !f) return <p className="hint">讀取中…</p>;

  const retry = async (kind: 'job' | 'mail', id: number) => {
    try {
      await (kind === 'job' ? api.admin.retryJob(id) : api.admin.retryMail(id));
      app.toast('已排入重試。');
      await load();
    } catch (e) {
      app.toast((e as Error).message);
    }
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      app.toast(msg);
      await load();
    } catch (e) {
      app.toast((e as Error).message);
    }
  };

  const failedMail = (s.mails.failed ?? 0) + f.mails.filter((m) => m.status !== 'failed').length;
  const failedJobs = (s.jobs.failed ?? 0) + f.jobs.filter((j) => j.status !== 'failed').length;

  return (
    <div id="admin">
      <div className="tomb-head">
        <h2 className="h2">管理</h2>
        <p className="hint">
          只有數字與狀態，看不到信件內容。服務狀態與 log 請看 KubeSphere。更新時間 {fmt(s.serverTime)}
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Tile label="使用者" value={s.users.total} note={`近 24 小時新增 ${s.users.last24h}`} />
        <Tile label="寄出的信" value={s.shipments.total} note={`近 24 小時 ${s.shipments.last24h}`} />
        <Tile label="路上" value={s.shipments.inTransit} />
        <Tile label="已送達未簽收" value={s.shipments.waiting} />
        <Tile label="已簽收" value={s.shipments.signed} />
        <Tile label="已退回" value={s.shipments.returned} />
        <Tile label="寄信問題" value={failedMail} warn={failedMail > 0} note={`寄信方式：${s.mailer}`} />
        <Tile label="排程問題" value={failedJobs} warn={failedJobs > 0} />
        <Tile label="待處理檢舉" value={s.reports.open} warn={s.reports.open > 0} note={`停權中 ${s.users.suspended} 人`} />
        <Tile label="資料庫大小" value={mb(s.storage.dbBytes)} note={`上傳檔案 ${s.storage.files} 個、${mb(s.storage.fileBytes)}`} />
      </div>

      <Counts title="信件狀態" data={s.letters} names={LETTER} />
      <Counts title="排程" data={s.jobs} names={JOB} />
      <Counts title="寄信" data={s.mails} names={MAIL} />

      <div className="section">
        <span className="label">檢舉・{rp.filter((r) => r.status === 'open').length} 件待處理</span>
        <p className="hint">只有檢舉原因與檢舉人寫的說明，看不到信件內容。成立就停權：對方不能再寄信。</p>
        {!rp.length ? (
          <p className="hint">沒有。</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>時間</th>
                <th>單號</th>
                <th>原因</th>
                <th>說明</th>
                <th>寄件人</th>
                <th>狀態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rp.map((r) => (
                <tr key={r.id}>
                  <td>{fmt(r.createdAt)}</td>
                  <td>{r.no}</td>
                  <td>{REASON[r.reason] ?? r.reason}</td>
                  <td style={{ maxWidth: 260, wordBreak: 'break-all' }}>{r.note}</td>
                  <td>
                    {r.sender.email}
                    <br />
                    <span className="hint">
                      被檢舉 {r.sender.reports} 次{r.sender.suspended ? '・停權中' : ''}
                    </span>
                  </td>
                  <td>{STATUS[r.status] ?? r.status}</td>
                  <td>
                    {r.status === 'open' && (
                      <button type="button" className="btn small ghost" onClick={() => void act(() => api.admin.dismissReport(r.id), '標成不成立。')}>
                        不成立
                      </button>
                    )}
                    {r.sender.suspended ? (
                      <button type="button" className="btn small" onClick={() => void act(() => api.admin.unsuspend(r.sender.id), '解除停權了。')}>
                        解除停權
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => confirm(`停權 ${r.sender.email}？對方之後不能再寄信。`) && void act(() => api.admin.suspend(r.sender.id), '停權了。')}
                      >
                        停權
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <span className="label">寄信失敗或重試中・{f.mails.length}</span>
        {!f.mails.length ? (
          <p className="hint">沒有。</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>種類</th>
                <th>收件信箱</th>
                <th>狀態</th>
                <th>次數</th>
                <th>原因</th>
                <th>下次</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {f.mails.map((m) => (
                <tr key={m.id}>
                  <td>{KIND[m.kind] ?? m.kind}</td>
                  <td>{m.to}</td>
                  <td>{MAIL[m.status] ?? m.status}</td>
                  <td>{m.attempts}</td>
                  <td style={{ maxWidth: 320, wordBreak: 'break-all' }}>{m.lastError}</td>
                  <td>{fmt(m.nextAttemptAt)}</td>
                  <td>
                    <button type="button" className="btn small" onClick={() => void retry('mail', m.id)}>
                      重試
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <span className="label">排程失敗或重試中・{f.jobs.length}</span>
        {!f.jobs.length ? (
          <p className="hint">沒有。</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>種類</th>
                <th>狀態</th>
                <th>次數</th>
                <th>原因</th>
                <th>預定時間</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {f.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{KIND[j.kind] ?? j.kind}</td>
                  <td>{JOB[j.status] ?? j.status}</td>
                  <td>{j.attempts}</td>
                  <td style={{ maxWidth: 320, wordBreak: 'break-all' }}>{j.lastError}</td>
                  <td>{fmt(j.runAt)}</td>
                  <td>
                    <button type="button" className="btn small" onClick={() => void retry('job', j.id)}>
                      重試
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
