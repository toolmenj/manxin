/**
 * 前後端共用型別（API 的輸入與輸出）。時間一律是 epoch 毫秒；顯示時由前端轉成臺北時間、民國紀年。
 */
import type {
  Cell,
  CharCell,
  EnvelopeKind,
  Fold,
  FoldEdge,
  MailboxColor,
  MarkTool,
  MissingCode,
  Pack,
  Piece,
  PlaceId,
  PlanEvent,
  Pos,
  PostmarkId,
  RecvState,
  ReturnPostmark,
  SheetKind,
  SheetStyle,
  ShipState,
  StampId,
  Stroke,
  TravelMode,
  WriteMode,
} from '@manxin/engine';

export type {
  Cell,
  CharCell,
  EnvelopeKind,
  Fold,
  FoldEdge,
  MailboxColor,
  MarkTool,
  MissingCode,
  Pack,
  Piece,
  PlaceId,
  PlanEvent,
  Pos,
  PostmarkId,
  RecvState,
  ReturnPostmark,
  SheetKind,
  SheetStyle,
  ShipState,
  StampId,
  Stroke,
  TravelMode,
  WriteMode,
};

/**
 * 信紙的格位排版與可寫區域（前後端共用同一套規則，前端畫面先算、後端驗證）。
 * 只從 engine 的 sheet 模組拿，前端不會連帶載入物流時間引擎。
 */
export {
  applyOp,
  canMoveTo,
  cellKey,
  charWidth,
  fitText,
  gridCursor,
  handArea,
  inkOf,
  isBlank,
  nextFreeInRow,
  normCursor,
  occupancy,
  paperGrid,
  POSTCARD_BODY_X,
  type HandArea,
  type PaperGrid,
  type PaperRef,
  type SheetContent,
  type SheetOp,
} from '@manxin/engine/sheet';

/* ---------- 錯誤 ---------- */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'GONE'
  | 'CONFLICT'
  | 'INVALID_TOKEN'
  | 'LETTER_LOCKED'
  | 'SEQ_CONFLICT'
  | 'SHEET_CHANGED'
  | 'SHEET_EMPTY'
  | 'SHEET_NOT_EMPTY'
  | 'REFS_PENDING'
  | 'LETTER_EMPTY'
  | 'TRIP_ACTIVE'
  | 'NO_TRIP'
  | 'NOT_ARRIVED'
  | 'NOT_AT_POST_OFFICE'
  | 'ENVELOPE_LOCKED'
  | 'STAMP_LOCKED'
  | 'POSTMARK_LOCKED'
  | 'ALREADY_DONE'
  | 'INVALID_EMAIL'
  | 'TOO_WIDE'
  | 'TOO_LONG'
  | 'TOO_MANY_FOLDS'
  | 'FOLD_OUT_OF_RANGE'
  | 'NOT_READY'
  | 'NO_EDITS_LEFT'
  | 'SAME_EMAIL'
  | 'NOT_DELIVERED'
  | 'SIGNED'
  | 'RETURNED'
  | 'INVALID_OP'
  | 'INVALID_STATE'
  | 'DEV_ONLY'
  | 'INTERNAL';

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

/* ---------- 帳號 ---------- */

export interface UserDTO {
  id: string;
  email: string;
}

/* ---------- 書桌 ---------- */

export type LetterStatus = 'drafting' | 'shelved' | 'sent';
export type DiscardState = 'crumple' | 'fold' | 'keep';

export interface EnvAddress {
  fromName: string;
  fromEmail: string;
  fromAddr: string;
  toName: string;
  toEmail: string;
  toAddr: string;
}

export interface SheetDTO {
  id: string;
  kind: SheetKind;
  style: SheetStyle;
  mode: WriteMode;
  /** 內建字型代號（typewriter、lead、ming、kai、song），或自訂字型 'f:<字型 id>' */
  font: string;
  /** 自訂字型的檔案網址（寄件人看是 /fonts/:id，收件人看是 /r/:token/fonts/:id）；內建字型是 null */
  fontUrl: string | null;
  bgAttachmentId: string | null;
  /** 內建信紙圖樣範本 id（GET /paper-templates）；和 bgAttachmentId 二選一，有任一個時 style 是 custom */
  bgTemplate: string | null;
  /** 追加操作的筆數；追加時可帶 seq 做樂觀鎖 */
  seq: number;
  /** 格位排版時每個字帶 p（落在哪一格）；順排（舊信紙、沒移過打字頭）沒有 */
  chars: CharCell[];
  /** 打字頭：[行, 半格]。null（或沒有這個欄位）＝順排，字一路往後接 */
  cursor?: Cell | null;
  strokes: Stroke[];
  scan: string | null;
  createdAt: number;
}

export interface AttachmentDTO {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: number;
}

/** 自訂字型（D-027：存在後端，換瀏覽器、收件人開信都載得到） */
export interface FontDTO {
  id: string;
  /** 信紙設定 font 要填的值：'f:<id>' */
  font: string;
  name: string;
  format: 'ttf' | 'otf' | 'woff' | 'woff2';
  size: number;
  /** 讀檔網址（需登入，只有上傳者） */
  url: string;
  createdAt: number;
}

/** 內建信紙圖樣範本 */
export interface PaperTemplateDTO {
  id: string;
  name: string;
  /** 比較搭哪個年代風格（只是分類，兩種年代都能用） */
  era: '80s' | 'minguo';
  note: string;
  /** SVG 網址（公開，不需要登入） */
  url: string;
}

export interface LetterDTO {
  id: string;
  status: LetterStatus;
  env: EnvAddress;
  sheet: SheetDTO;
  /** 謄抄後留在桌邊、還沒處理的舊信紙 */
  refs: SheetDTO[];
  attachments: AttachmentDTO[];
  frontAttachmentId: string | null;
  createdAt: number;
  shelvedAt: number | null;
  askedAt: number | null;
  /** 先放著的信：是否到了該問「現在想寄出了嗎？」的時候 */
  askDue: boolean;
  trip: TripDTO | null;
}

export interface TombItemDTO {
  sheet: SheetDTO;
  state: DiscardState;
  angle: number;
  discardedAt: number;
  letterId: string | null;
}

export interface TombDTO {
  sheets: TombItemDTO[];
  unsent: LetterDTO[];
}

/* ---------- 郵局 ---------- */

export interface TripDTO {
  id: string;
  letterId: string;
  place: PlaceId;
  placeName: string;
  mode: TravelMode;
  box: MailboxColor;
  startAt: number;
  arriveAt: number;
  enteredAt: number | null;
  /** 伺服器現在時間（方便前端倒數） */
  serverNow: number;
  arrived: boolean;
}

export interface EnvelopeText {
  c: string[];
  s: Stroke[];
}

export interface CounterDTO {
  letterId: string;
  env: EnvelopeKind;
  envLocked: boolean;
  stamp: StampId;
  stampAttachmentId: string | null;
  pm: PostmarkId;
  pmAttachmentId: string | null;
  skinAttachmentId: string | null;
  stampPos: Pos | null;
  pmPos: Pos | null;
  pmAt: number | null;
  folds: Fold[];
  pack: Pack | null;
  rot: boolean;
  inserted: boolean;
  sealed: boolean;
  addrOk: boolean;
  etxt: { from: EnvelopeText; to: EnvelopeText };
  emode: WriteMode;
  missing: MissingCode[];
}

/* ---------- 物流 ---------- */

/** 送達時間怎麼算的（原型追蹤頁的「計算明細」）。D-020：送達之前不透露，所以送達前是 null */
export interface ShipmentCalcDTO {
  /** 交寄後最近的發車班次 */
  start: number;
  /** 基礎天數與理由 */
  base: number;
  baseWhy: string;
  /** 48 小時內的隨機延遲（毫秒） */
  randDelay: number;
  /** 天氣延遲（毫秒） */
  wDelay: number;
  /** 原始到達時間（還沒推到上班時間） */
  raw: number;
  /** 實際送達（推到上班時間後） */
  deliver: number;
}

export interface ShipmentDTO {
  no: string;
  letterId: string;
  sentAt: number;
  office: string;
  box: MailboxColor;
  state: ShipState;
  curEmail: string;
  curDeliver: number;
  editsLeft: number;
  reached: number;
  stops: string[];
  /** 只列出現在時間以前發生的事件（新到舊） */
  events: PlanEvent[];
  deliverAt: number | null;
  signedAt: number | null;
  returnedAt: number | null;
  returnPostmark: ReturnPostmark | null;
  env: EnvAddress;
  /** 送達後才有 */
  calc: ShipmentCalcDTO | null;
}

export interface TrackDTO {
  no: string;
  state: ShipState;
  office: string;
  stops: string[];
  reached: number;
  events: PlanEvent[];
}

/* ---------- 收信 ---------- */

export interface ReceiveDTO {
  no: string;
  fromName: string;
  office: string;
  sentAt: number;
  pkg: Omit<CounterDTO, 'letterId' | 'missing' | 'envLocked' | 'addrOk' | 'emode'> & {
    /** 信封上的字型（D-028：寄出時跟信紙一致） */
    efont: string;
    /** efont 是自訂字型時的檔案網址（/r/:token/fonts/:id），否則 null */
    efontUrl: string | null;
  };
  recv: RecvState;
  /** 攤開（或撕破）之後才有內容 */
  letter: { sheet: SheetDTO; attachments: AttachmentDTO[]; frontAttachmentId: string | null } | null;
  /** 倒出來之後就看得到附件（信紙還摺著也一樣） */
  attachments: AttachmentDTO[] | null;
}

/* ---------- 收藏 ---------- */

export interface CollectionDTO {
  letters: { no: string; fromName: string; at: number; torn: boolean }[];
  stamps: { no: string; stamp: StampId; stampAttachmentId: string | null; fiber: boolean; fromName: string; at: number }[];
  waxes: { no: string; fiber: boolean; fromName: string; at: number }[];
}

/* ---------- 書寫操作（只有追加） ---------- */

/**
 * 每個追加請求都可以帶：
 * - seq：客戶端認為目前的追加次數，不一致回 409 SEQ_CONFLICT
 * - sheetId：客戶端認為目前的信紙，換過紙（謄抄）回 409 SHEET_CHANGED
 * - opId：客戶端產生的 UUID。同一張信紙上已經有這個 opId 就不再寫一次，直接回目前的信紙（200）——回應遺失後重送不會重複
 */
export interface AppendMeta {
  seq?: number;
  sheetId?: string;
  opId?: string;
}
export interface AppendCharsBody extends AppendMeta {
  text: string;
}
/** at：要塗改的字（第幾個字，從 0 起）；舊的 from–to 範圍寫法仍然接受 */
export interface AppendMarkBody extends AppendMeta {
  at?: number[];
  from?: number;
  to?: number;
  tool: MarkTool;
}
export interface AppendStrokeBody extends AppendMeta {
  stroke: Stroke;
}
/** 移動打字頭到 [行, 半格]（只能停在可寫區域裡的空格） */
export interface AppendMoveBody extends AppendMeta {
  at: Cell;
}
export interface FoldBody {
  edge: FoldEdge;
  at: number;
}
