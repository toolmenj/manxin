import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** 決定性的連結 token：同一個輸入永遠得到同一個 token（排程重跑時連結不變） */
export const hmacToken = (secret: string, input: string): string =>
  createHmac('sha256', secret).update(input).digest('base64url');

/** 0–1 的亂數（伺服器擲骰用） */
export const roll = (): number => randomInt(0, 1_000_000_000) / 1_000_000_000;

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const normEmail = (e: string): string => e.trim().toLowerCase();
