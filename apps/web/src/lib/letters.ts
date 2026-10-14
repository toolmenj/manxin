/**
 * 「書桌上的那封信」：後端可以有好幾封 drafting 的信（例如拿出抽屜的信、空白的新信），
 * 前端照下面的順序挑一封：正在去郵局的 → 有寫東西的（最新的）→ 最新的空白信 → 都沒有就開一封新的。
 */
import type { LetterDTO } from '@manxin/shared';
import { api, attachmentUrl } from '../api/client.ts';
import { hasContent, viewSheet, type ViewSheet } from './paper.ts';
import type { Era } from './time.ts';

export const letterHas = (L: LetterDTO): boolean => hasContent(L.sheet) || L.refs.length > 0 || L.attachments.length > 0;

/** 依年代風格決定新信紙的預設樣子（原型 setEra） */
export function eraDefaults(era: Era): { style?: 'bahang'; font?: string } {
  return era === 'minguo' ? { style: 'bahang', font: 'lead' } : {};
}

export function pickCurrent(letters: LetterDTO[]): LetterDTO | null {
  return letters.find((l) => l.trip) ?? letters.find(letterHas) ?? letters[0] ?? null;
}

export async function loadCurrentLetter(era: Era, create = true): Promise<LetterDTO | null> {
  const { letters } = await api.listLetters('drafting');
  const cur = pickCurrent(letters);
  if (cur || !create) return cur;
  return api.createLetter(eraDefaults(era));
}

/** 寄件人自己的信紙（圖片走 /attachments/:id） */
export const ownSheet = (L: LetterDTO, which = L.sheet): ViewSheet => viewSheet(which, attachmentUrl);
