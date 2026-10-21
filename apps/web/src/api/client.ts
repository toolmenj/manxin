/**
 * 慢信 API client。規格見 docs/api.md，型別來自 @manxin/shared。
 *
 * - 所有請求走 /api 前綴（Vite proxy 去掉前綴再轉給後端），避免和前端網址（/r/:token、/track/:no）撞名。
 * - 沒有 body 的 POST 不帶 content-type（Fastify 會把空的 JSON body 當成錯誤）。
 * - 錯誤一律丟 ApiError，code 對應 docs/api.md 的錯誤碼。
 * - 書寫只有追加操作（chars／marks／strokes，以及只移動打字頭的 moves）與空白紙的紙本匯入；這裡刻意沒有任何修改或刪除內容的函式。
 */
import type {
  AppendMeta,
  AttachmentDTO,
  Cell,
  CollectionDTO,
  CounterDTO,
  DiscardState,
  EnvAddress,
  EnvelopeKind,
  ErrorCode,
  FoldEdge,
  FontDTO,
  LetterDTO,
  LetterStatus,
  MailboxColor,
  MarkTool,
  PaperTemplateDTO,
  PlaceId,
  Piece,
  Pos,
  PostmarkId,
  ReceiveDTO,
  SheetDTO,
  SheetKind,
  SheetStyle,
  ShipmentDTO,
  StampId,
  Stroke,
  TombDTO,
  TrackDTO,
  TravelMode,
  TripDTO,
  UserDTO,
  WriteMode,
} from '@manxin/shared';

export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** details.reason（INVALID_OP、INVALID_STATE 用） */
  get reason(): string | undefined {
    const d = this.details as { reason?: unknown } | undefined;
    return typeof d?.reason === 'string' ? d.reason : undefined;
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code);

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** 測試用：換掉 fetch */
export function setFetch(f: Fetch): void {
  fetchImpl = f;
}

type Body = object | FormData | undefined;

export async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetchImpl(API_BASE + path, init);
  } catch (e) {
    throw new ApiError(0, 'NETWORK', '連不上伺服器，請確認網路或稍後再試。', e);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: ErrorCode; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `伺服器回應 ${res.status}`, err?.details);
  }
  return data as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b?: Body) => request<T>('POST', p, b);
const patch = <T>(p: string, b: Body) => request<T>('PATCH', p, b);
const enc = encodeURIComponent;

/** 後端回傳的檔案網址（/attachments/:id、/r/:token/attachments/:id）加上 /api 前綴 */
export const fileUrl = (url: string): string => (url.startsWith(API_BASE + '/') ? url : API_BASE + url);
export const attachmentUrl = (id: string): string => `${API_BASE}/attachments/${id}`;
export const recvAttachmentUrl = (token: string, id: string): string => `${API_BASE}/r/${enc(token)}/attachments/${id}`;
/** 內建信紙圖樣範本的 SVG（公開） */
export const paperTemplateUrl = (id: string): string => `${API_BASE}/paper-templates/${enc(id)}.svg`;

export interface PlacesDTO {
  places: { id: PlaceId; name: string; kind: string; m: number; minutes: Record<TravelMode, number> }[];
  modes: Record<TravelMode, { label: string; mpm: number; extra: number }>;
}

export interface OutboxMail {
  id: number;
  key: string;
  to: string;
  subject: string;
  text: string;
  meta: { kind?: string; token?: string; no?: string; seq?: number; letterId?: string; postmark?: unknown } & Record<string, unknown>;
  createdAt: number;
}

export interface SheetSettings {
  kind?: SheetKind;
  style?: SheetStyle;
  mode?: WriteMode;
  font?: string;
  bgAttachmentId?: string | null;
  bgTemplate?: string | null;
}

export interface CounterPatch {
  env?: EnvelopeKind;
  skinAttachmentId?: string;
  stamp?: StampId;
  stampAttachmentId?: string | null;
  pm?: PostmarkId;
  pmAttachmentId?: string | null;
  rot?: boolean;
  emode?: WriteMode;
}

export type UploadPurpose = 'attachment' | 'scan' | 'bg' | 'front' | 'stamp' | 'postmark' | 'skin';

/** 追加請求的附帶資訊：沒給的欄位不送（舊的呼叫可以只給 seq） */
const metaOf = (m?: AppendMeta | number): AppendMeta => {
  const o = typeof m === 'number' ? { seq: m } : (m ?? {});
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as AppendMeta;
};

export const api = {
  /* 帳號 */
  me: () => get<{ user: UserDTO }>('/me'),
  magicLink: (email: string) => post<{ ok: true }>('/auth/magic-link', { email }),
  verify: (token: string) => post<{ user: UserDTO }>('/auth/verify', { token }),
  logout: () => post<void>('/auth/logout'),

  /* 時間與地點 */
  time: () => get<{ now: number; tz: string; offsetMs?: number }>('/time'),
  places: () => get<PlacesDTO>('/places'),

  /* 書桌 */
  createLetter: (b: SheetSettings & { env?: Partial<EnvAddress> } = {}) => post<LetterDTO>('/letters', b),
  listLetters: (status?: LetterStatus) => get<{ letters: LetterDTO[] }>(`/letters${status ? `?status=${status}` : ''}`),
  getLetter: (id: string) => get<LetterDTO>(`/letters/${id}`),
  patchLetter: (id: string, b: { env?: Partial<EnvAddress>; frontAttachmentId?: string | null }) => patch<LetterDTO>(`/letters/${id}`, b),
  patchSheet: (id: string, b: SheetSettings) => patch<SheetDTO>(`/letters/${id}/sheet`, b),

  /* 信紙內容：只有追加 */
  appendChars: (id: string, text: string, meta?: AppendMeta | number) => post<SheetDTO>(`/letters/${id}/sheet/chars`, { text, ...metaOf(meta) }),
  /** at：要塗改的字（第幾個字）的清單 */
  appendMark: (id: string, at: number[], tool: MarkTool, meta?: AppendMeta | number) => post<SheetDTO>(`/letters/${id}/sheet/marks`, { at, tool, ...metaOf(meta) }),
  /** 移動打字頭（不寫字、不蓋字） */
  appendMove: (id: string, at: Cell, meta?: AppendMeta | number) => post<SheetDTO>(`/letters/${id}/sheet/moves`, { at, ...metaOf(meta) }),
  appendStroke: (id: string, stroke: Stroke, meta?: AppendMeta | number) => post<SheetDTO>(`/letters/${id}/sheet/strokes`, { stroke, ...metaOf(meta) }),
  scan: (id: string, attachmentId: string) => post<SheetDTO>(`/letters/${id}/sheet/scan`, { attachmentId }),

  transcribe: (id: string) => post<LetterDTO>(`/letters/${id}/transcribe`),
  discardRef: (id: string, sheetId: string, state: DiscardState, to: 'tomb' | 'trash') =>
    post<LetterDTO>(`/letters/${id}/refs/${sheetId}/discard`, { state, to }),
  tomb: () => get<TombDTO>('/tomb'),
  shelve: (id: string) => post<LetterDTO>(`/letters/${id}/shelve`),
  unshelve: (id: string) => post<LetterDTO>(`/letters/${id}/unshelve`),
  askLater: (id: string) => post<LetterDTO>(`/letters/${id}/ask-later`),

  upload: (id: string, file: Blob, purpose: UploadPurpose = 'attachment', name = 'image.jpg') => {
    const fd = new FormData();
    fd.append('file', file, name);
    return post<AttachmentDTO>(`/letters/${id}/attachments?purpose=${purpose}`, fd);
  },
  takeOut: (id: string, attId: string) => post<LetterDTO>(`/letters/${id}/attachments/${attId}/take-out`),

  /* 自訂字型與信紙範本 */
  fonts: () => get<{ fonts: FontDTO[] }>('/fonts'),
  uploadFont: (file: Blob, name: string) => {
    const fd = new FormData();
    fd.append('file', file, name);
    return post<FontDTO>('/fonts', fd);
  },
  paperTemplates: () => get<{ templates: PaperTemplateDTO[] }>('/paper-templates'),

  /* 郵局 */
  startTrip: (id: string, b: { place: PlaceId; mode: TravelMode; box: MailboxColor }) => post<TripDTO>(`/letters/${id}/trip`, b),
  getTrip: (id: string) => get<{ trip: TripDTO | null }>(`/letters/${id}/trip`),
  enter: (id: string) => post<{ trip: TripDTO; counter: CounterDTO }>(`/letters/${id}/trip/enter`),
  goHome: (id: string) => post<void>(`/letters/${id}/trip/home`),

  /* 櫃台 */
  counter: (id: string) => get<CounterDTO>(`/letters/${id}/counter`),
  patchCounter: (id: string, b: CounterPatch) => patch<CounterDTO>(`/letters/${id}/counter`, b),
  confirmAddress: (id: string) => post<CounterDTO>(`/letters/${id}/counter/confirm-address`),
  envelopeText: (id: string, zone: 'from' | 'to', text: string) => post<CounterDTO>(`/letters/${id}/counter/envelope-text`, { zone, text }),
  envelopeStroke: (id: string, zone: 'from' | 'to', stroke: Stroke) => post<CounterDTO>(`/letters/${id}/counter/envelope-text`, { zone, stroke }),
  fold: (id: string, edge: FoldEdge, at: number) => post<CounterDTO>(`/letters/${id}/counter/folds`, { edge, at }),
  insert: (id: string) => post<CounterDTO>(`/letters/${id}/counter/insert`),
  seal: (id: string) => post<CounterDTO>(`/letters/${id}/counter/seal`),
  stamp: (id: string, p: Pos) => post<CounterDTO>(`/letters/${id}/counter/stamp`, { x: p.x, y: p.y, r: p.r }),
  postmark: (id: string, p: Pos) => post<CounterDTO>(`/letters/${id}/counter/postmark`, { x: p.x, y: p.y, r: p.r }),
  postLetter: (id: string) => post<ShipmentDTO>(`/letters/${id}/post`),

  /* 物流 */
  track: (no: string) => get<TrackDTO>(`/track/${enc(no)}`),
  shipments: () => get<{ shipments: ShipmentDTO[] }>('/shipments'),
  shipment: (no: string) => get<ShipmentDTO>(`/shipments/${enc(no)}`),
  editRecipientEmail: (no: string, email: string) => post<ShipmentDTO>(`/shipments/${enc(no)}/recipient-email`, { email }),
  collection: () => get<CollectionDTO>('/collection'),

  /* 收信（不需要登入） */
  recv: (token: string) => get<ReceiveDTO>(`/r/${enc(token)}`),
  recvEnter: (token: string) => post<ReceiveDTO>(`/r/${enc(token)}/enter`),
  recvOpen: (token: string, method: 'knife' | 'tear', cutPath?: string) =>
    post<ReceiveDTO>(`/r/${enc(token)}/open`, cutPath ? { method, cutPath: cutPath.slice(0, 4000) } : { method }),
  recvTear: (token: string, x: number) => post<ReceiveDTO>(`/r/${enc(token)}/tear`, { x: Math.min(1, Math.max(0, x)) }),
  recvPieces: (token: string, pieces: Piece[]) => post<ReceiveDTO>(`/r/${enc(token)}/pieces`, { pieces }),
  recvPryStamp: (token: string) => post<ReceiveDTO>(`/r/${enc(token)}/pry-stamp`),
  recvPryWax: (token: string) => post<ReceiveDTO>(`/r/${enc(token)}/pry-wax`),
  recvPour: (token: string) => post<ReceiveDTO>(`/r/${enc(token)}/pour`),
  recvUnfold: (token: string) => post<ReceiveDTO>(`/r/${enc(token)}/unfold`),
  recvCollect: (token: string) => post<ReceiveDTO>(`/r/${enc(token)}/collect`),

  /* 開發用（正式環境不存在） */
  dev: {
    outbox: (to?: string, limit = 100) => get<{ mails: OutboxMail[] }>(`/dev/outbox?limit=${limit}${to ? `&to=${enc(to)}` : ''}`),
    clock: () => get<{ now: number; offsetMs: number }>('/dev/clock'),
    advance: (advanceMs: number) => post<{ now: number; offsetMs: number; jobs: unknown }>('/dev/clock', { advanceMs }),
    resetClock: () => post<{ now: number; offsetMs: number; jobs: unknown }>('/dev/clock', { reset: true }),
    runWorker: () => post<{ jobs: unknown }>('/dev/worker/run'),
  },
};
