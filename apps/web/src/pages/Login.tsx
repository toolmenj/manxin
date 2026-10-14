/**
 * 登入：email magic link（D-008 暫定）。/login?token=… 是登入信裡的連結。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, isApiError } from '../api/client.ts';
import { okMail } from '../lib/util.ts';
import { useApp } from '../state/app.tsx';

export function LoginPage() {
  const app = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const token = sp.get('token');
  const next = sp.get('next') || '/desk';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (!token || tried.current) return;
    tried.current = true;
    setBusy(true);
    api
      .verify(token)
      .then((r) => {
        app.setUser(r.user);
        app.toast('登入了。');
        nav(next.startsWith('/') ? next : '/desk', { replace: true });
      })
      .catch((e) => setErr(isApiError(e, 'INVALID_TOKEN') ? '這個登入連結無效或過期了（15 分鐘內有效，只能用一次）。再寄一次吧。' : (e as Error).message))
      .finally(() => setBusy(false));
  }, [token, next, app, nav]);

  const send = async () => {
    const v = email.trim();
    if (!okMail(v)) {
      setErr('信箱格式不對，像 name@example.com 這樣。');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.magicLink(v);
      setSent(v);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (app.user && !token)
    return (
      <div className="empty">
        <h2 className="h2">已經登入了</h2>
        <p>{app.user.email}</p>
        <button type="button" className="btn primary" onClick={() => nav('/desk')}>
          去書桌
        </button>
      </div>
    );

  return (
    <div className="login panel">
      <h2 className="h2">用電子信箱登入</h2>
      {token ? (
        <p className="hint">{busy ? '正在確認登入連結…' : err}</p>
      ) : sent ? (
        <>
          <p>
            登入信寄到 <b>{sent}</b> 了。點信裡的連結就能登入（15 分鐘內有效，只能用一次）。
          </p>
          {app.devOffset !== null && (
            <p className="hint">
              開發環境不會真的寄信。
              <button type="button" className="btn small" onClick={() => nav('/mailbox?to=' + encodeURIComponent(sent))}>
                打開本機信箱
              </button>
            </p>
          )}
          <button type="button" className="btn ghost small" onClick={() => setSent(null)}>
            換一個信箱
          </button>
        </>
      ) : (
        <>
          <p className="hint">不用密碼。我們寄一封登入信給你，點信裡的連結就好。</p>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input type="email" autoComplete="email" placeholder="name@example.com" aria-label="電子信箱" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="btn primary" disabled={busy}>
              寄登入信
            </button>
          </form>
          {err && <p className="hint warn-text">{err}</p>}
          {app.devOffset !== null && <p className="hint">開發用範例帳號：zhe@example.com（寄件人）、wen@example.org（收件人）。</p>}
        </>
      )}
    </div>
  );
}
