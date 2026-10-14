/**
 * 資料庫結構（drizzle-orm）。改這裡之後執行 npm run db:generate 產生遷移。
 * 時間欄位一律 timestamptz；寫入時用應用程式時鐘（含開發用偏移），不用資料庫的 now()。
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  createdAt: ts('created_at').notNull(),
});

export const loginTokens = pgTable('login_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull(),
});

export const sessions = pgTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull(),
});

/** status：drafting 書桌上／shelved 先放著（未寄出的信）／sent 已寄出（內容唯讀） */
export const letters = pgTable(
  'letters',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('drafting'),
    env: jsonb('env').notNull(),
    frontAttachmentId: uuid('front_attachment_id'),
    createdAt: ts('created_at').notNull(),
    shelvedAt: ts('shelved_at'),
    askedAt: ts('asked_at'),
    sentAt: ts('sent_at'),
  },
  (t) => [index('letters_user_idx').on(t.userId, t.status)],
);

/**
 * role：current 書桌上正在寫的／ref 謄抄後留在桌邊／tomb 字紙冢。
 * 丟進垃圾桶 = 直接刪掉這一列（連同 sheet_ops）。
 */
export const sheets = pgTable(
  'sheets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    letterId: uuid('letter_id').references(() => letters.id, { onDelete: 'set null' }),
    role: text('role').notNull(),
    kind: text('kind').notNull(),
    style: text('style').notNull(),
    mode: text('mode').notNull(),
    font: text('font').notNull(),
    bgAttachmentId: uuid('bg_attachment_id'),
    createdAt: ts('created_at').notNull(),
    discardState: text('discard_state'),
    discardAngle: integer('discard_angle'),
    discardedAt: ts('discarded_at'),
  },
  (t) => [index('sheets_letter_idx').on(t.letterId, t.role), index('sheets_user_role_idx').on(t.userId, t.role)],
);

/** 信紙內容的追加紀錄。只有 INSERT（資料庫觸發器擋下 UPDATE 與單獨 DELETE） */
export const sheetOps = pgTable(
  'sheet_ops',
  {
    sheetId: uuid('sheet_id')
      .notNull()
      .references(() => sheets.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    op: jsonb('op').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sheetId, t.seq] })],
);

/** purpose：attachment 附件／scan 紙本匯入／bg 信紙圖樣／front 明信片正面／stamp 郵票／postmark 郵戳／skin 信封圖 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    letterId: uuid('letter_id').references(() => letters.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    path: text('path').notNull(),
    createdAt: ts('created_at').notNull(),
    /** 「拿出來」：不再跟著這封信（檔案保留） */
    takenOutAt: ts('taken_out_at'),
  },
  (t) => [index('attachments_letter_idx').on(t.letterId)],
);

/** 前往郵局。arriveAt 由伺服器算，抵達與否只看伺服器時間 */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    letterId: uuid('letter_id')
      .notNull()
      .references(() => letters.id, { onDelete: 'cascade' }),
    place: text('place').notNull(),
    mode: text('mode').notNull(),
    box: text('box').notNull(),
    startAt: ts('start_at').notNull(),
    arriveAt: ts('arrive_at').notNull(),
    enteredAt: ts('entered_at'),
    endedAt: ts('ended_at'),
    /** home 帶著信回家／posted 投進郵筒 */
    endReason: text('end_reason'),
  },
  (t) => [
    index('trips_letter_idx').on(t.letterId),
    uniqueIndex('trips_one_active_per_letter').on(t.letterId).where(sql`ended_at is null`),
  ],
);

/** 郵局櫃台的狀態（每封信一份；回家再來，摺痕都還在） */
export const counters = pgTable('counters', {
  letterId: uuid('letter_id')
    .primaryKey()
    .references(() => letters.id, { onDelete: 'cascade' }),
  env: text('env').notNull(),
  skinAttachmentId: uuid('skin_attachment_id'),
  stamp: text('stamp').notNull(),
  stampAttachmentId: uuid('stamp_attachment_id'),
  pm: text('pm').notNull(),
  pmAttachmentId: uuid('pm_attachment_id'),
  stampPos: jsonb('stamp_pos'),
  pmPos: jsonb('pm_pos'),
  pmAt: ts('pm_at'),
  folds: jsonb('folds').notNull(),
  pack: jsonb('pack'),
  rot: boolean('rot').notNull().default(false),
  inserted: boolean('inserted').notNull().default(false),
  sealed: boolean('sealed').notNull().default(false),
  addrOk: boolean('addr_ok').notNull().default(false),
  emode: text('emode').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

/** 信封上的字（寄件人／收件人區），同樣只能追加 */
export const envelopeOps = pgTable(
  'envelope_ops',
  {
    letterId: uuid('letter_id')
      .notNull()
      .references(() => letters.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    zone: text('zone').notNull(),
    op: jsonb('op').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.letterId, t.seq] })],
);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    no: text('no').notNull().unique(),
    letterId: uuid('letter_id')
      .notNull()
      .unique()
      .references(() => letters.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sentAt: ts('sent_at').notNull(),
    office: text('office').notNull(),
    box: text('box').notNull(),
    /** 寄出時的地址快照 */
    env: jsonb('env').notNull(),
    /** 寄出時的信封、郵票、郵戳、摺痕快照 */
    pkg: jsonb('pkg').notNull(),
    plan: jsonb('plan').notNull(),
    deliverAt: ts('deliver_at').notNull(),
    signedAt: ts('signed_at'),
    returnedAt: ts('returned_at'),
    recv: jsonb('recv').notNull(),
    /** 目前有效的開信連結（雜湊）。改寄或退信後清空 */
    recipientTokenHash: text('recipient_token_hash').unique(),
    deliverySeq: integer('delivery_seq').notNull().default(-1),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('shipments_user_idx').on(t.userId)],
);

export const emailEdits = pgTable(
  'email_edits',
  {
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    email: text('email').notNull(),
    at: ts('at').notNull(),
    deliverAt: ts('deliver_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.seq] })],
);

/** 收藏：收到的信、撬下來的郵票與火漆。屬於收件信箱（登入同一個信箱即可看到） */
export const collectionItems = pgTable(
  'collection_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    recipientEmail: text('recipient_email').notNull(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    fiber: boolean('fiber').notNull().default(false),
    at: ts('at').notNull(),
  },
  (t) => [
    uniqueIndex('collection_one_per_kind').on(t.shipmentId, t.kind),
    index('collection_email_idx').on(t.recipientEmail),
  ],
);

/**
 * 排程工作。unique_key 保證同一件事只排一次；worker 用 FOR UPDATE SKIP LOCKED 認領，
 * 寄信與標記完成在同一個交易裡，重跑不會重寄。
 */
export const scheduledJobs = pgTable(
  'scheduled_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    uniqueKey: text('unique_key').notNull().unique(),
    refId: text('ref_id').notNull(),
    runAt: ts('run_at').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    payload: jsonb('payload').notNull().default({}),
    result: text('result'),
    createdAt: ts('created_at').notNull(),
    doneAt: ts('done_at'),
  },
  (t) => [index('scheduled_jobs_due_idx').on(t.status, t.runAt)],
);

/** ConsoleMailer 的本機信箱（GET /dev/outbox） */
export const devOutbox = pgTable('dev_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  text: text('text').notNull(),
  meta: jsonb('meta').notNull().default({}),
  createdAt: ts('created_at').notNull(),
});
