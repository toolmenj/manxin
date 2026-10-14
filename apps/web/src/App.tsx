import { type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Empty, Modal } from './components/common.tsx';
import { Header, viewOf } from './components/Header.tsx';
import { CollectionPage } from './pages/Collection.tsx';
import { DeskPage } from './pages/Desk.tsx';
import { HomePage } from './pages/Home.tsx';
import { InboxPage } from './pages/Inbox.tsx';
import { LoginPage } from './pages/Login.tsx';
import { MailboxPage } from './pages/Mailbox.tsx';
import { PostPage } from './pages/Post.tsx';
import { ReceivePage } from './pages/Receive.tsx';
import { TombPage } from './pages/Tomb.tsx';
import { TrackPage } from './pages/Track.tsx';
import { AppProvider, useApp } from './state/app.tsx';

/** 每一頁都是 main 底下的一個 section（原型的 #v-xxx），換頁時重新掛上去，播「墨水暈開」的進場 */
function View({ id, children, login = true }: { id: string; children: ReactNode; login?: boolean }) {
  const app = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  let body = children;
  if (login && !app.user) {
    body = app.userLoading ? (
      <p className="hint">讀取中…</p>
    ) : (
      <Empty title="先登入">
        <p>書桌、郵局、追蹤和字紙冢都跟著你的帳號。用電子信箱登入，不用密碼。</p>
        <button type="button" className="btn primary" onClick={() => nav('/login?next=' + encodeURIComponent(loc.pathname))}>
          用電子信箱登入
        </button>
      </Empty>
    );
  }
  return (
    <section id={'v-' + id} className="entering" key={id}>
      {body}
    </section>
  );
}

function Shell() {
  const loc = useLocation();
  const v = viewOf(loc.pathname);
  return (
    <>
      <Header />
      <main data-view={v}>
        <Routes>
          <Route path="/" element={<View id="home" login={false}><HomePage /></View>} />
          <Route path="/desk" element={<View id="desk"><DeskPage /></View>} />
          <Route path="/post" element={<View id="post"><PostPage /></View>} />
          <Route path="/track" element={<View id="track" login={false}><TrackPage /></View>} />
          <Route path="/track/:no" element={<View id="track" login={false}><TrackPage /></View>} />
          <Route path="/inbox" element={<View id="inbox"><InboxPage /></View>} />
          <Route path="/r/:token" element={<View id="inbox" login={false}><ReceivePage /></View>} />
          <Route path="/coll" element={<View id="coll"><CollectionPage /></View>} />
          <Route path="/tomb" element={<View id="tomb"><TombPage /></View>} />
          <Route path="/login" element={<View id="login" login={false}><LoginPage /></View>} />
          <Route path="/mailbox" element={<View id="mailbox" login={false}><MailboxPage /></View>} />
          <Route path="*" element={<View id="404" login={false}><Empty title="這裡什麼都沒有" /></View>} />
        </Routes>
      </main>
      <Modal />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  );
}
