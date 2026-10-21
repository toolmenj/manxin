/**
 * 頁首：慢信標誌、導覽、年代風格、模擬時間與「快轉」（開發環境）。
 */
import { useNavigate, useLocation } from 'react-router';
import { api } from '../api/client.ts';
import { clockTxt, fmt, type Era } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';
import { useNow } from './common.tsx';

export const VIEWS = [
  ['home', '首頁', '/'],
  ['desk', '書桌', '/desk'],
  ['post', '郵局', '/post'],
  ['track', '追蹤', '/track'],
  ['inbox', '收信', '/inbox'],
  ['coll', '收藏', '/coll'],
  ['tomb', '字紙冢', '/tomb'],
] as const;

export function viewOf(path: string): string {
  if (path === '/') return 'home';
  const seg = path.split('/')[1] ?? '';
  if (seg === 'r') return 'inbox';
  return VIEWS.find(([, , p]) => p === '/' + seg)?.[0] ?? '';
}

const FF: [string, number][] = [
  ['+1 小時', 3600000],
  ['+1 天', 86400000],
  ['+7 天', 604800000],
  ['+30 天', 2592000000],
];

export function Header() {
  const app = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const t = useNow(1000);
  const cur = viewOf(loc.pathname);
  const n = app.counts;
  const num: Record<string, number> = { track: n.track, inbox: n.inbox, coll: n.coll, tomb: n.tomb };

  const ff = async (ms: number | 'reset', el: HTMLElement) => {
    try {
      if (ms === 'reset') await api.dev.resetClock();
      else await api.dev.advance(ms);
      await app.syncTime();
      app.bumpTime();
      app.toast('模擬時間：' + fmt(app.now()));
    } catch (e) {
      app.toast((e as Error).message);
    }
    el.closest('details')?.removeAttribute('open');
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    app.setUser(null);
    nav('/');
    app.toast('登出了。');
  };

  return (
    <header className="top">
      <div className="top-in">
        <div className="brand">
          <span className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>
            慢信
          </span>
          <span className="motto">從前慢，如今也慢。</span>
        </div>
        <nav className="tabs" aria-label="主要區域">
          {VIEWS.map(([k, label, path]) => (
            <button key={k} type="button" data-view={k} aria-current={cur === k ? 'page' : 'false'} onClick={() => nav(path)}>
              {label}
              {k in num ? <span className="n">{num[k] || ''}</span> : null}
            </button>
          ))}
        </nav>
        <div className="seg era" id="eraSeg" role="group" aria-label="年代風格">
          {(
            [
              ['80s', '八〇年代'],
              ['minguo', '民國初年'],
              ['doodle', '手繪塗鴉'],
              ['map', '藏寶圖'],
            ] as [Era, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" data-v={v} aria-pressed={app.prefs.era === v} onClick={() => void app.switchEra(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="clock">
          <span className="lbl">{app.devOffset !== null ? '模擬時間' : '現在'}</span>
          <span id="clockTxt">{clockTxt(t, app.prefs.era)}</span>
          {app.devOffset !== null ? (
            <details className="ff">
              <summary>快轉</summary>
              <div className="ffm">
                <p>開發用。快轉的是伺服器的時鐘：路程、物流、簽收提醒、退信、30 天詢問都照新時間計算。</p>
                <div className="row">
                  {FF.map(([l, ms]) => (
                    <button key={ms} type="button" className="btn small" data-ff={ms} onClick={(e) => void ff(ms, e.currentTarget)}>
                      {l}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn small ghost" data-ff="reset" onClick={(e) => void ff('reset', e.currentTarget)}>
                  回到現在
                </button>
                <p style={{ marginTop: 6 }}>{app.user ? `登入中：${app.user.email}` : '還沒登入。'}</p>
                <div className="row">
                  <button type="button" className="btn small" onClick={(e) => (nav('/mailbox'), e.currentTarget.closest('details')?.removeAttribute('open'))}>
                    本機信箱
                  </button>
                  {app.user ? (
                    <button type="button" className="btn small ghost" onClick={(e) => (void logout(), e.currentTarget.closest('details')?.removeAttribute('open'))}>
                      登出
                    </button>
                  ) : (
                    <button type="button" className="btn small" onClick={(e) => (nav('/login'), e.currentTarget.closest('details')?.removeAttribute('open'))}>
                      登入
                    </button>
                  )}
                </div>
              </div>
            </details>
          ) : app.user ? (
            <details className="ff">
              <summary>帳號</summary>
              <div className="ffm">
                <p>登入中：{app.user.email}</p>
                <button type="button" className="btn small ghost" onClick={() => void logout()}>
                  登出
                </button>
              </div>
            </details>
          ) : (
            !app.userLoading && (
              <button type="button" className="btn small" onClick={() => nav('/login')}>
                登入
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
}
