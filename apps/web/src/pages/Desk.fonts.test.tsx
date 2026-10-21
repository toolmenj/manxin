/**
 * 書桌：信紙範本（落筆後鎖住）與自訂字型（存到後端，D-027）。
 */
import type { FontDTO, LetterDTO, SheetDTO } from '@manxin/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BASE_ROUTES, fakeApi, letterOf, renderPage } from '../test/fakeApi.tsx';
import { DeskPage } from './Desk.tsx';

const TEMPLATES = [
  { id: 'huajian', name: '民國花箋', era: 'minguo', note: '朱紅雙框', url: '/paper-templates/huajian.svg' },
  { id: 'airmail80', name: '航空信紙', era: '80s', note: '紅藍斜紋', url: '/paper-templates/airmail80.svg' },
];
const FONT: FontDTO = {
  id: '00000007-0000-4000-8000-000000000000',
  font: 'f:00000007-0000-4000-8000-000000000000',
  name: '阿哲的字',
  format: 'woff2',
  size: 100,
  url: '/fonts/00000007-0000-4000-8000-000000000000',
  createdAt: 0,
};

function setup(text = '', fonts: FontDTO[] = []) {
  let L: LetterDTO = letterOf(text);
  const api = fakeApi({
    ...BASE_ROUTES,
    'GET /letters': (_b: unknown, u: URL) => ({ letters: u.searchParams.get('status') === 'drafting' ? [L] : [] }),
    'GET /letters/:id': () => L,
    'GET /paper-templates': { templates: TEMPLATES },
    'GET /fonts': { fonts },
    'POST /fonts': FONT,
    'PATCH /letters/:id/sheet': (b: unknown) => {
      const p = b as Partial<SheetDTO>;
      const sheet = { ...L.sheet, ...p };
      if (p.bgTemplate) Object.assign(sheet, { style: 'custom', bgAttachmentId: null });
      if (p.font?.startsWith('f:')) sheet.fontUrl = '/fonts/' + p.font.slice(2);
      L = { ...L, sheet };
      return sheet;
    },
  });
  renderPage(<DeskPage />, '/desk');
  return { api, get: () => L };
}

describe('信紙範本', () => {
  it('空白信紙：點範本 → PATCH bgTemplate，紙上鋪上範本圖樣', async () => {
    const { api } = setup('');
    const btn = await screen.findByRole('button', { name: '民國花箋' });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH' && (c.body as { bgTemplate?: string })?.bgTemplate === 'huajian')).toBe(true));
    await waitFor(() => expect(document.querySelector<HTMLElement>('#pw .paper')!.style.backgroundImage).toContain('/api/paper-templates/huajian.svg'));
    expect(screen.getByRole('button', { name: '民國花箋' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector<HTMLSelectElement>('#styleSel')!.value).toBe('custom');
  });

  it('已落筆：範本按鈕全部鎖住（照舊「落筆後鎖紙」）', async () => {
    const { api } = setup('小雯：');
    const btn = await screen.findByRole('button', { name: '航空信紙' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });
});

describe('自訂字型', () => {
  it('之前上傳過的字型出現在字型選單（換瀏覽器也在）', async () => {
    setup('', [FONT]);
    await waitFor(() => expect(screen.getByRole('option', { name: '自訂：阿哲的字' })).toBeInTheDocument());
  });

  it('上傳字型：存到後端（POST /fonts），信紙換成 f:<id>，不再提示「還沒存到伺服器」', async () => {
    const { api, get } = setup('');
    await screen.findByRole('button', { name: '民國花箋' });
    const input = document.querySelector<HTMLInputElement>('input[accept=".ttf,.otf,.woff,.woff2"]')!;
    const file = new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0])], '阿哲的字.woff2', { type: 'font/woff2' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(get().sheet.font).toBe(FONT.font));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/fonts')).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('#fontSel')!.value).toBe(FONT.font);
    expect(screen.queryByText(/還沒存到伺服器/)).toBeNull();
    expect(await screen.findByText(/字型收好了/)).toBeInTheDocument();
  });

  it('副檔名不對：不上傳', async () => {
    const { api } = setup('');
    await screen.findByRole('button', { name: '民國花箋' });
    const input = document.querySelector<HTMLInputElement>('input[accept=".ttf,.otf,.woff,.woff2"]')!;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt')] } });
    expect(await screen.findByText(/這個檔案讀不成字型/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/fonts' && c.method === 'POST')).toBe(false);
  });
});
