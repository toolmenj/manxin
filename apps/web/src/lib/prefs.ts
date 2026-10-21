/**
 * 個人偏好（年代風格、書桌、打字機種類、打字聲、筆與墨色）。只存在這個瀏覽器（localStorage）。
 * 讀寫都包 try/catch：無痕視窗或儲存被封鎖時照常運作，只是不記得。
 */
import type { Era } from './time.ts';

export type DeskKind = 'wood' | 'white' | 'school';
/** keys＝電腦輸入法、py＝拼音鍵盤（簡體）。舊版的 tw／cn（中文打字機字盤）已移除，讀到時退回 keys */
export type TwMode = 'keys' | 'py';
export const TW_MODES: TwMode[] = ['keys', 'py'];

export interface Prefs {
  era: Era;
  desk: DeskKind;
  twMode: TwMode;
  sound: boolean;
  pen: { pen: 'fountain' | 'ball' | 'pencil'; color: string };
  postSel: { place: 'box' | 'po' | 'main'; mode: 'walk' | 'bike' | 'car'; box: 'green' | 'red' };
  /** 書桌上次照哪個年代擺空白信紙（換年代時，空白信紙跟著換八行箋／橫線） */
  deskEra?: Era;
}

export const DEFAULT_PREFS: Prefs = {
  era: '80s',
  desk: 'wood',
  twMode: 'keys',
  sound: true,
  pen: { pen: 'fountain', color: '#1F2F4F' },
  postSel: { place: 'box', mode: 'walk', box: 'green' },
};

const KEY = 'manxin.prefs.v1';

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    // trayMirror（字盤的「看反字」）是舊版欄位，字盤移除後丟掉
    const { trayMirror: _old, ...p } = JSON.parse(raw) as Partial<Prefs> & { trayMirror?: unknown };
    return {
      ...DEFAULT_PREFS,
      ...p,
      era: (['80s', 'minguo', 'doodle', 'map'] as const).includes(p.era as Era) ? (p.era as Era) : DEFAULT_PREFS.era,
      desk: (['wood', 'white', 'school'] as const).includes(p.desk as DeskKind) ? (p.desk as DeskKind) : DEFAULT_PREFS.desk,
      twMode: TW_MODES.includes(p.twMode as TwMode) ? (p.twMode as TwMode) : DEFAULT_PREFS.twMode,
      pen: { ...DEFAULT_PREFS.pen, ...(p.pen ?? {}) },
      postSel: { ...DEFAULT_PREFS.postSel, ...(p.postSel ?? {}) },
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 存不了就算了，偏好不是重要資料 */
  }
}

export const DESKS: Record<DeskKind, { label: string; tomb: string; coll: string }> = {
  wood: { label: '木桌・綠檯燈', tomb: '老式抽屜', coll: '另一個抽屜' },
  white: { label: '白桌・長燈帶', tomb: '小型金屬收納箱', coll: '另一個金屬收納箱' },
  school: { label: '課桌', tomb: '桌斗', coll: '另一格桌斗' },
};

export const ERA_INFO: Record<Era, [string, string, string, string, string]> = {
  '80s': ['八〇年代', '磨石子地、郵局綠招牌、標籤機貼條', '#2D5E44', '#E2B13C', '#D8C597'],
  minguo: ['民國初年', '宣紙、朱印、八行箋直書', '#B03A2E', '#211A10', '#EADBB4'],
  doodle: ['手繪塗鴉', '暗褐石頭地、粗黑歪線', '#2A1E16', '#B3302A', '#EFE2C4'],
  map: ['藏寶圖', '木板牆、舊地圖、虛線路徑、咖啡漬', '#5C1F1C', '#A58374', '#E8E1BE'],
};

export const DESK_SW: Record<DeskKind, string> = {
  wood: 'linear-gradient(#7A4C2C,#5E3920)',
  white: 'linear-gradient(#F4F4F1,#E1E1DD)',
  school: 'linear-gradient(#DDBE8C,#CDAA74)',
};

/* ---------- 收件人在這個瀏覽器開過的開信連結（收藏頁拿來重看信） ---------- */
const RKEY = 'manxin.recvTokens.v1';

export function rememberToken(no: string, token: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(RKEY) || '{}') as Record<string, string>;
    m[no] = token;
    localStorage.setItem(RKEY, JSON.stringify(m));
  } catch {
    /* 略過 */
  }
}

export function knownTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(RKEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
