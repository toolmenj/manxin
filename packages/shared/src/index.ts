/**
 * 前後端共用型別（API 的輸入與輸出）。時間一律是 epoch 毫秒；顯示時由前端轉成臺北時間、民國紀年。
 */
import type {
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
  font: string;
  bgAttachmentId: string | null;
  /** 追加操作的筆數；追加時可帶 seq 做樂觀鎖 */
  seq: number;
  chars: CharCell[];
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
  pkg: Omit<CounterDTO, 'letterId' | 'missing' | 'envLocked' | 'addrOk' | 'emode'>;
  recv: RecvState;
  /** 攤開（或撕破）之後才有內容 */
  letter: { sheet: SheetDTO; attachments: AttachmentDTO[]; frontAttachmentId: string | null } | null;
}

/* ---------- 收藏 ---------- */

export interface CollectionDTO {
  letters: { no: string; fromName: string; at: number; torn: boolean }[];
  stamps: { no: string; stamp: StampId; stampAttachmentId: string | null; fiber: boolean; fromName: string; at: number }[];
  waxes: { no: string; fiber: boolean; fromName: string; at: number }[];
}

/* ---------- 書寫操作（只有追加） ---------- */

export interface AppendCharsBody {
  text: string;
  /** 選填：客戶端認為目前的 seq，不一致回 409 SEQ_CONFLICT（避免重送造成重複） */
  seq?: number;
}
export interface AppendMarkBody {
  from: number;
  to: number;
  tool: MarkTool;
  seq?: number;
}
export interface AppendStrokeBody {
  stroke: Stroke;
  seq?: number;
}
export interface FoldBody {
  edge: FoldEdge;
  at: number;
}
