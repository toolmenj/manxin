/**
 * 帳號設定：偏好跟著帳號走（D-034）、封鎖名單、登出所有裝置、刪除帳號。
 * 刪除帳號（使用者決定）：寄出的信留給收件人，其他都刪掉。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { forgetTokens } from '../lib/prefs.ts';
import { fmt } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';

export function AccountPage() {
  const app = useApp();
  const nav = useNavigate();
  const [blocks, setBlocks] = useState<{ id: string; senderName: string; createdAt: number }[] | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .blocks()
      .then((r) => setBlocks(r.blocks))
      .catch(() => setBlocks([]));
  }, []);
  useEffect(load, [load]);

  if (!app.user) return null;
  const email = app.user.email;

  const unblock = async (id: string) => {
    try {
      await api.unblock(id);
      app.toast('解除封鎖了。之後這個人寄來的信會照常送到。');
      load();
    } catch (e) {
      app.toast((e as Error).message);
    }
  };

  const logoutAll = async () => {
    setBusy(true);
    try {
      await api.logoutAll();
      forgetTokens();
      app.setUser(null);
      app.toast('所有裝置都登出了。');
      nav('/');
    } catch (e) {
      app.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (confirm.trim().toLowerCase() !== email.toLowerCase()) {
      app.toast('請輸入自己的信箱確認。');
      return;
    }
    setBusy(true);
    try {
      await api.closeAccount(confirm.trim());
      forgetTokens();
      try {
        localStorage.clear();
      } catch {
        /* 略過 */
      }
      app.setUser(null);
      app.toast('帳號刪除了。寄出去的信還在收件人那裡。');
      nav('/');
    } catch (e) {
      app.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account">
      <div className="tomb-head">
        <h2 className="h2">帳號設定</h2>
        <p className="hint">登入中：{email}</p>
      </div>

      <div className="section panel" style={{ padding: 16 }}>
        <span className="label">偏好</span>
        <p>年代風格、書桌、打字機與筆的設定會跟著帳號走，換一台電腦或手機登入也一樣。</p>
      </div>

      <div className="section panel" style={{ padding: 16 }}>
        <span className="label">封鎖名單</span>
        <p className="hint">封鎖的人寄來的信不會送到你這裡；對方不會知道被封鎖。</p>
        {!blocks ? (
          <p className="hint">讀取中…</p>
        ) : !blocks.length ? (
          <p className="hint">沒有封鎖任何人。</p>
        ) : (
          <ul className="plain-list">
            {blocks.map((b) => (
              <li key={b.id}>
                <span>
                  {b.senderName}（{fmt(b.createdAt, { time: false })} 封鎖）
                </span>
                <button type="button" className="btn small ghost" onClick={() => void unblock(b.id)}>
                  解除封鎖
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="section panel" style={{ padding: 16 }}>
        <span className="label">登出所有裝置</span>
        <p className="hint">在別人的電腦登入過、或手機掉了，可以把所有地方的登入一次取消。</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void logoutAll()}>
          登出所有裝置
        </button>
      </div>

      <div className="section panel danger-zone" style={{ padding: 16 }}>
        <span className="label">刪除帳號</span>
        <p>
          會刪掉：書桌上、抽屜裡還沒寄的信，字紙冢，上傳的檔案與沒被寄出的信用到的字型，收到的收藏，封鎖名單與偏好。
        </p>
        <p>
          <b>已經寄出的信不會收回</b>——它們已經屬於收件人了，就像寄出去的實體信一樣。信上的寄件人名稱會留著，但你的信箱會拿掉，之後不會再收到提醒或退信通知。
        </p>
        <p className="hint">刪除之後不能復原。同一個信箱之後可以重新登入，但會是全新的帳號。</p>
        <label className="field">
          <span>輸入你的信箱確認：</span>
          <input type="email" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={email} autoComplete="off" />
        </label>
        <button type="button" className="btn danger" id="deleteAccount" disabled={busy || confirm.trim().toLowerCase() !== email.toLowerCase()} onClick={() => void remove()}>
          刪除帳號
        </button>
      </div>
    </div>
  );
}
