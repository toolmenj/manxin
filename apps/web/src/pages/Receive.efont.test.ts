/** D-028：收件人看到的信封字型跟信紙一致（收藏重看也是用同一個 recvPkg） */
import type { ReceiveDTO } from '@manxin/shared';
import { describe, expect, it } from 'vitest';
import { counterOf, sheetOf } from '../test/fakeApi.tsx';
import { recvPkg, recvSheet } from './Receive.tsx';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const FONT = 'f:00000009-0000-4000-8000-000000000000';

function dto(pkgExtra: Partial<ReceiveDTO['pkg']>, letter: ReceiveDTO['letter'] = null): ReceiveDTO {
  const { letterId: _l, missing: _m, envLocked: _e, addrOk: _a, emode: _em, ...pkg } = counterOf();
  return {
    no: 'RR123456785TW',
    fromName: '阿哲',
    office: '巷口郵筒',
    sentAt: 0,
    pkg: { ...pkg, efont: 'kai', efontUrl: null, ...pkgExtra },
    recv: {
      entered: true,
      opened: true,
      method: 'knife',
      rough: false,
      cutPath: '',
      torn: null,
      pieces: null,
      poured: true,
      unfolded: true,
      collected: false,
      stampTaken: false,
      stampFiber: false,
      waxTaken: false,
      waxFiber: false,
    },
    letter,
    attachments: null,
  };
}

describe('收信的信封字型', () => {
  it('用後端回傳的 efont（不再一律文楷）', () => {
    expect(recvPkg(dto({ efont: 'ming' }), TOKEN).efont).toBe('ming');
    expect(recvPkg(dto({ efont: FONT, efontUrl: `/r/${TOKEN}/fonts/x` }), TOKEN).efont).toBe(FONT);
  });

  it('舊資料沒有 efont：退回文楷', () => {
    expect(recvPkg(dto({ efont: '' }), TOKEN).efont).toBe('kai');
  });

  it('信紙：自訂字型的網址與範本圖樣跟著過來', () => {
    const d = dto({}, { sheet: sheetOf('字', { font: FONT, fontUrl: `/r/${TOKEN}/fonts/x`, style: 'custom', bgTemplate: 'waves' }), attachments: [], frontAttachmentId: null });
    const s = recvSheet(d, TOKEN)!;
    expect(s.font).toBe(FONT);
    expect(s.fontUrl).toBe(`/r/${TOKEN}/fonts/x`);
    expect(s.bg).toBe('/api/paper-templates/waves.svg');
  });
});
