/**
 * 寄信（D-002）。開發階段不真的寄：ConsoleMailer 印到 log，並存進 dev_outbox（GET /dev/outbox 查看）。
 * 之後換 Resend 只改 MAILER=resend 與 RESEND_API_KEY。
 *
 * idempotencyKey：同一個 key 只會寄一次（排程重跑不重寄）。
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.ts';
import { devOutbox } from '../db/schema.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  meta?: Record<string, unknown>;
}

export interface Mailer {
  /**
   * 寄出一封信。db 可傳入交易，讓「寄信」與「標記工作完成」一起成功或一起失敗。
   * 回傳 false 表示這個 idempotencyKey 已經寄過。
   */
  send(msg: MailMessage, db: Db, now: number): Promise<boolean>;
}

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
}

/**
 * TODO(D-002)：串接 Resend。
 * - POST https://api.resend.com/emails，Authorization: Bearer RESEND_API_KEY
 * - 帶 Idempotency-Key header = msg.idempotencyKey（Resend 支援 24 小時內去重）
 * - 為了在交易外失敗時不重寄，建議另建 sent_emails 表記錄已寄的 key（與 dev_outbox 同結構）
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly from: string,
  ) {}
  async send(_msg: MailMessage): Promise<boolean> {
    void this.apiKey;
    void this.from;
    throw new Error('ResendMailer 尚未實作（TODO D-002）。開發階段請用 MAILER=console。');
  }
}
