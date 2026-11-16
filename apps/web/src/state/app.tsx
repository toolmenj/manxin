/**
 * 全站狀態：登入者、個人偏好、伺服器時間、提示、彈窗、頁首的數字。
 */
import type { UserDTO } from '@manxin/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isApiError } from '../api/client.ts';
import { anim } from '../lib/motion.ts';
import { loadPrefs, sanitizePrefs, savePrefs, type Prefs } from '../lib/prefs.ts';
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
  /** 目前登入的是管理員（ADMIN_EMAILS）。只用來顯示管理頁入口，權限在後端檢查 */
  admin: boolean;
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
  const [admin, setAdmin] = useState(false);
  const uid = user?.id ?? null;
  useEffect(() => {
    if (!uid) {
      setAdmin(false);
      return;
    }
    let alive = true;
    api
      .me()
      .then((r) => alive && setAdmin(!!r.admin))
      .catch(() => alive && setAdmin(false));
    return () => {
      alive = false;
    };
  }, [uid]);
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

  /*
   * D-034：偏好跟著帳號走。登入後先讀伺服器上的（有就蓋過這台的；沒有就把這台的存上去），
   * 之後改偏好停 1 秒再存回伺服器（連點不會每下都送）。
   */
  const prefsSynced = useRef<string | null>(null);
  const prefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    prefsSynced.current = null;
    if (!uid) return;
    let alive = true;
    api
      .getPrefs()
      .then((r) => {
        if (!alive) return;
        if (r.prefs) {
          const n = sanitizePrefs(r.prefs);
          savePrefs(n);
          setPrefsState(n);
        } else void api.putPrefs(loadPrefs() as unknown as Record<string, unknown>).catch(() => undefined);
        prefsSynced.current = uid;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [uid]);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const n = { ...old, ...p };
      savePrefs(n);
      if (prefsSynced.current) {
        if (prefsTimer.current) clearTimeout(prefsTimer.current);
        prefsTimer.current = setTimeout(() => void api.putPrefs(n as unknown as Record<string, unknown>).catch(() => undefined), 1000);
      }
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
    const t = setInterval(() => document.visibilityState === 'visible' && void syncTime(), 60_000);
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
      api
        .inbox()
        .then((r) => r.unopened)
        .catch(() => 0),
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

  // 收件匣、追蹤的數字每分鐘更新一次；分頁在背景時不更新（review M14）
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => document.visibilityState === 'visible' && void refreshCounts(), 60_000);
    const onVis = () => document.visibilityState === 'visible' && void refreshCounts();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user, refreshCounts]);

  const bumpTime = useCallback(() => setTimeVersion((v) => v + 1), []);

  const value = useMemo<AppState>(
    () => ({
      user,
      userLoading,
      admin,
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
    [user, userLoading, admin, prefs, setPrefs, switchEra, now, syncTime, devOffset, toast, nag, modal, closeModal, counts, refreshCounts, timeVersion, bumpTime],
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

export interface DeliveryLink {
  token: string;
  no: string;
  to: string;
  at: number;
  subject: string;
  text: string;
}

/** 開發用：本機信箱（GET /dev/outbox）裡寄給某個信箱的開信通知；正式環境沒有這個端點，回傳空陣列 */
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
