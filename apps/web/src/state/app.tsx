/**
 * 全站狀態：登入者、個人偏好、伺服器時間、提示、彈窗、頁首的數字。
 */
import type { UserDTO } from '@manxin/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isApiError } from '../api/client.ts';
import { anim } from '../lib/motion.ts';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs.ts';
import type { Era } from '../lib/time.ts';

export interface ModalSpec {
  content: ReactNode;
  /** 點背景或按 Esc 能不能關（預設可以） */
  dismissable?: boolean;
  onClose?: () => void;
  /** 每次打開都不一樣，讓「落定」動畫重播 */
  id?: number;
}

export interface Counts {
  track: number;
  inbox: number;
  coll: number;
  tomb: number;
}

export interface AppState {
  user: UserDTO | null;
  userLoading: boolean;
  setUser: (u: UserDTO | null) => void;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  switchEra: (era: Era) => Promise<void>;
  /** 伺服器現在幾點（本機時鐘 + 校正量） */
  now: () => number;
  /** 重新向伺服器對時 */
  syncTime: () => Promise<void>;
  /** 開發環境才有的時鐘偏移 */
  devOffset: number | null;
  toast: (msg: string) => void;
  nag: (msg: string) => void;
  modal: ModalSpec | null;
  openModal: (m: ModalSpec) => void;
  closeModal: () => void;
  counts: Counts;
  refreshCounts: () => Promise<void>;
  /** 時間往前快轉後，各頁面重新讀資料用 */
  timeVersion: number;
  bumpTime: () => void;
}

const Ctx = createContext<AppState | null>(null);
let modalSeq = 0;

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp 要在 AppProvider 裡面用');
  return c;
}

function applyDocPrefs(p: Prefs) {
  const d = document.documentElement;
  d.dataset.era = p.era;
  d.dataset.desk = p.desk;
  d.dataset.twmode = p.twMode;
}

export function AppProvider({ children, initialUser }: { children: ReactNode; initialUser?: UserDTO | null }) {
  const [user, setUser] = useState<UserDTO | null>(initialUser ?? null);
  const [userLoading, setUserLoading] = useState(initialUser === undefined);
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs());
  const skew = useRef(0);
  const [devOffset, setDevOffset] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nagAt = useRef(0);
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [counts, setCounts] = useState<Counts>({ track: 0, inbox: 0, coll: 0, tomb: 0 });
  const [timeVersion, setTimeVersion] = useState(0);

  useEffect(() => applyDocPrefs(prefs), [prefs]);

  useEffect(() => {
    if (initialUser !== undefined) return;
    api
      .me()
      .then((r) => setUser(r.user))
      // 沒登入：保持原狀（登入連結頁可能已經先登入成功了，不要蓋掉）
      .catch(() => undefined)
      .finally(() => setUserLoading(false));
  }, [initialUser]);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const n = { ...old, ...p };
      savePrefs(n);
      return n;
    });
  }, []);

  const switchEra = useCallback(
    async (era: Era) => {
      if (era === prefs.era) return;
      const b = document.body;
      await anim(
        b,
        [
          { opacity: 1, filter: 'none' },
          { opacity: 0.35, offset: 0.18 },
          { opacity: 0.95, offset: 0.26 },
          { opacity: 0.15, offset: 0.52 },
          { opacity: 0.55, offset: 0.6 },
          { opacity: 0, filter: 'sepia(1) blur(2px)' },
        ],
        { d: 750, e: 'linear' },
      );
      setPrefs({ era });
      await anim(
        b,
        [
          { opacity: 0, filter: 'sepia(1) blur(3px)' },
          { opacity: 0.7, offset: 0.22 },
          { opacity: 0.2, offset: 0.32 },
          { opacity: 0.85, offset: 0.46 },
          { opacity: 0.55, offset: 0.56 },
          { opacity: 1, filter: 'none' },
        ],
        { d: 1200, e: 'ease-out' },
      );
      b.getAnimations().forEach((a) => a.cancel());
    },
    [prefs.era, setPrefs],
  );

  const now = useCallback(() => Date.now() + skew.current, []);

  const syncTime = useCallback(async () => {
    const t0 = Date.now();
    try {
      const r = await api.time();
      const t1 = Date.now();
      // 以來回時間的中點校正
      skew.current = r.now - (t0 + t1) / 2;
      setDevOffset(typeof r.offsetMs === 'number' ? r.offsetMs : null);
    } catch {
      /* 對時失敗就沿用上一次 */
    }
  }, []);

  useEffect(() => {
    void syncTime();
    const t = setInterval(() => void syncTime(), 60_000);
    return () => clearInterval(t);
  }, [syncTime]);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);
  const nag = useCallback(
    (m: string) => {
      if (Date.now() - nagAt.current < 900) return;
      nagAt.current = Date.now();
      toast(m);
    },
    [toast],
  );

  const closeModal = useCallback(() => {
    setModal((m) => {
      m?.onClose?.();
      return null;
    });
  }, []);

  const refreshCounts = useCallback(async () => {
    if (!user) {
      setCounts({ track: 0, inbox: 0, coll: 0, tomb: 0 });
      return;
    }
    const [sh, tb, co, ib] = await Promise.all([
      api.shipments().catch(() => null),
      api.tomb().catch(() => null),
      api.collection().catch(() => null),
      unopenedCount(user.email).catch(() => 0),
    ]);
    setCounts({
      track: sh?.shipments.length ?? 0,
      tomb: tb ? tb.sheets.length + tb.unsent.length : 0,
      coll: co ? co.letters.length + co.stamps.length + co.waxes.length : 0,
      inbox: ib,
    });
  }, [user]);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts, timeVersion]);

  const bumpTime = useCallback(() => setTimeVersion((v) => v + 1), []);

  const value = useMemo<AppState>(
    () => ({
      user,
      userLoading,
      setUser,
      prefs,
      setPrefs,
      switchEra,
      now,
      syncTime,
      devOffset,
      toast,
      nag,
      modal,
      openModal: (m: ModalSpec) => setModal({ ...m, id: ++modalSeq }),
      closeModal,
      counts,
      refreshCounts,
      timeVersion,
      bumpTime,
    }),
    [user, userLoading, prefs, setPrefs, switchEra, now, syncTime, devOffset, toast, nag, modal, closeModal, counts, refreshCounts, timeVersion, bumpTime],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast" id="toast" hidden={!toastMsg} role="status" aria-live="polite">
        {toastMsg}
      </div>
    </Ctx.Provider>
  );
}

/** 寄給這個信箱、還沒拆的信（開發環境從本機信箱找開信通知） */
async function unopenedCount(email: string): Promise<number> {
  const links = await deliveryLinks(email);
  let n = 0;
  await Promise.all(
    links.map(async (l) => {
      try {
        const r = await api.recv(l.token);
        if (!r.recv.opened) n++;
      } catch {
        /* 連結失效（改寄、退回）就不算 */
      }
    }),
  );
  return n;
}

export interface DeliveryLink {
  token: string;
  no: string;
  to: string;
  at: number;
  subject: string;
  text: string;
}

/** 本機信箱（GET /dev/outbox）裡寄給某個信箱的開信通知；正式環境沒有這個端點，回傳空陣列 */
export async function deliveryLinks(email: string): Promise<DeliveryLink[]> {
  try {
    const r = await api.dev.outbox(email.toLowerCase(), 200);
    const seen = new Set<string>();
    const out: DeliveryLink[] = [];
    for (const m of r.mails) {
      if (m.meta?.kind !== 'deliver' || typeof m.meta.token !== 'string') continue;
      const no = String(m.meta.no ?? '');
      // 同一封信改寄過會有好幾封通知，只留最新的（outbox 由新到舊）
      if (seen.has(no)) continue;
      seen.add(no);
      out.push({ token: m.meta.token, no, to: m.to, at: m.createdAt, subject: m.subject, text: m.text });
    }
    return out;
  } catch (e) {
    if (isApiError(e)) return [];
    throw e;
  }
}
