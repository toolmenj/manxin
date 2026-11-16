/**
 * 寄信（D-002；正式環境用 Gmail SMTP）。
 *
 * - ConsoleMailer（開發、測試）：不真的寄，印到 log 並存進 dev_outbox（GET /dev/outbox 查看）。
 * - OutboxMailer（正式）：outbox 模式（review H7）。
 *   send() 在呼叫端的交易裡只寫 email_outbox；交易成功後 flush() 才透過 SMTP 寄出。
 *   SMTP 慢或失敗不會鎖住資料列；失敗會退避重試，最多 MAX_MAIL_ATTEMPTS 次。
 *   寄出後清掉內文，避免登入／開信連結長期留在資料庫（review M12）。
 *
 * idempotencyKey：同一個 key 只會排一封（排程重跑不重排）。
 * 注意：SMTP 沒有冪等機制；若程序在「寄出」與「標記已寄」之間當掉，那一封可能重寄一次（至少一次）。
 */
import type { FastifyBaseLogger } from 'fastify';
import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { devOutbox, emailOutbox } from '../db/schema.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  meta?: Record<string, unknown>;
}

export interface Mailer {
  /**
   * 排入一封信。db 可傳入交易，讓「寄信」與「標記工作完成」一起成功或一起失敗。
   * 回傳 false 表示這個 idempotencyKey 已經排過。
   */
  send(msg: MailMessage, db: Db, now: number): Promise<boolean>;
  /** 交易成功之後呼叫：真的把排入的信寄出去。ConsoleMailer 不需要 */
  flush(db: Db, now: number): Promise<number>;
}

type Log = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

export class ConsoleMailer implements Mailer {
  constructor(
    private readonly log: Pick<FastifyBaseLogger, 'info'>,
    private readonly from: string,
  ) {}

  async send(msg: MailMessage, db: Db, now: number): Promise<boolean> {
    const rows = await db
      .insert(devOutbox)
      .values({
        idempotencyKey: msg.idempotencyKey,
        toEmail: msg.to,
        subject: msg.subject,
        text: msg.text,
        meta: msg.meta ?? {},
        createdAt: new Date(now),
      })
      .onConflictDoNothing({ target: devOutbox.idempotencyKey })
      .returning({ id: devOutbox.id });
    if (rows.length === 0) return false;
    this.log.info({ mail: { from: this.from, to: msg.to, subject: msg.subject } }, `[ConsoleMailer] ${msg.subject}\n${msg.text}`);
    return true;
  }

  async flush(): Promise<number> {
    return 0;
  }
}

/** 真正把信送出去的管道 */
export interface MailTransport {
  deliver(m: { to: string; subject: string; text: string }): Promise<void>;
}

/** Gmail（或任何 SMTP）。Gmail 要用「應用程式密碼」，不是登入密碼 */
export class SmtpTransport implements MailTransport {
  private transporter: Promise<{ sendMail(o: object): Promise<unknown> }>;
  constructor(
    opts: { host: string; port: number; secure: boolean; user: string | undefined; pass: string | undefined },
    private readonly from: string,
  ) {
    this.transporter = import('nodemailer').then((nm) =>
      nm.default.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure,
        auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
        // 外部服務一律設逾時（review H7）
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    );
  }
  async deliver(m: { to: string; subject: string; text: string }): Promise<void> {
    const t = await this.transporter;
    await t.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
  }
}

export const MAX_MAIL_ATTEMPTS = 8;
/** 寄送中超過這麼久沒有結果（程序當掉），視為失敗重來 */
const STALE_SENDING_MS = 10 * 60_000;

export class OutboxMailer implements Mailer {
  constructor(
    private readonly transport: MailTransport,
    private readonly log: Log,
  ) {}

  async send(msg: MailMessage, db: Db, now: number): Promise<boolean> {
    const rows = await db
      .insert(emailOutbox)
      .values({
        idempotencyKey: msg.idempotencyKey,
        toEmail: msg.to,
        subject: msg.subject,
        text: msg.text,
        kind: String(msg.meta?.kind ?? ''),
        nextAttemptAt: new Date(now),
        createdAt: new Date(now),
      })
      .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
      .returning({ id: emailOutbox.id });
    return rows.length > 0;
  }

  /** 寄出到期的信。每封先在短交易裡認領（SKIP LOCKED），交易外寄出，再回寫結果 */
  async flush(db: Db, now: number, limit = 50): Promise<number> {
    let sent = 0;
    for (let i = 0; i < limit; i++) {
      const claimed = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(emailOutbox)
          .where(
            or(
              and(eq(emailOutbox.status, 'pending'), lte(emailOutbox.nextAttemptAt, new Date(now))),
              and(eq(emailOutbox.status, 'sending'), lt(emailOutbox.claimedAt, new Date(now - STALE_SENDING_MS))),
            ),
          )
          .orderBy(emailOutbox.nextAttemptAt, emailOutbox.id)
          .limit(1)
          .for('update', { skipLocked: true });
        const r = rows[0];
        if (!r) return null;
        await tx.update(emailOutbox).set({ status: 'sending', claimedAt: new Date(now) }).where(eq(emailOutbox.id, r.id));
        return r;
      });
      if (!claimed) break;
      if (claimed.text === null) {
        // 內文已清掉（理論上不會發生），只能放棄
        await db.update(emailOutbox).set({ status: 'failed', lastError: 'no body' }).where(eq(emailOutbox.id, claimed.id));
        continue;
      }
      try {
        await this.transport.deliver({ to: claimed.toEmail, subject: claimed.subject, text: claimed.text });
        await db
          .update(emailOutbox)
          .set({ status: 'sent', sentAt: new Date(now), text: null, attempts: claimed.attempts + 1, lastError: null })
          .where(and(eq(emailOutbox.id, claimed.id), eq(emailOutbox.status, 'sending')));
        sent++;
        this.log.info({ mail: { id: claimed.id, kind: claimed.kind } }, 'mail sent');
      } catch (e) {
        const attempts = claimed.attempts + 1;
        const giveUp = attempts >= MAX_MAIL_ATTEMPTS;
        await db
          .update(emailOutbox)
          .set({
            status: giveUp ? 'failed' : 'pending',
            attempts,
            lastError: String((e as Error)?.message ?? e).slice(0, 1000),
            nextAttemptAt: new Date(now + Math.min(60, 2 ** attempts) * 60_000),
          })
          .where(and(eq(emailOutbox.id, claimed.id), eq(emailOutbox.status, 'sending')));
        this.log.error({ err: e, mail: { id: claimed.id, kind: claimed.kind, attempts } }, giveUp ? 'mail failed, giving up' : 'mail failed, will retry');
        // SMTP 掛了就先停，不要一路把剩下的信都試一次
        break;
      }
    }
    return sent;
  }

  /** 營運用：待寄、失敗的數量 */
  async stats(db: Db): Promise<Record<string, number>> {
    const rows = await db
      .select({ status: emailOutbox.status, n: sql<number>`count(*)::int` })
      .from(emailOutbox)
      .where(inArray(emailOutbox.status, ['pending', 'sending', 'failed']))
      .groupBy(emailOutbox.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}
