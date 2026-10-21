/**
 * 測試用：假的後端（依「方法 + 路徑」回應），以及把頁面包進 AppProvider + MemoryRouter。
 */
import type { CounterDTO, LetterDTO, SheetDTO, UserDTO } from '@manxin/shared';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { setFetch } from '../api/client.ts';
import { Modal } from '../components/common.tsx';
import { AppProvider } from '../state/app.tsx';

export type Handler = (body: unknown, url: URL) => unknown | Promise<unknown>;
export interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

export function fakeApi(routes: Record<string, Handler | unknown>) {
  const calls: Recorded[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    let body: unknown = undefined;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    calls.push({ method, path, body });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      if (m !== method) return false;
      const re = new RegExp('^' + p!.replace(/:[^/]+/g, '[^/]+') + '$');
      return re.test(path);
    });
    if (!key) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no route ' + method + ' ' + path } }), { status: 404 });
    const h = routes[key];
    try {
      const out = typeof h === 'function' ? await (h as Handler)(body, url) : h;
      if (out instanceof Response) return out;
      return new Response(out === undefined ? null : JSON.stringify(out), { status: out === undefined ? 204 : 200 });
    } catch (e) {
      const err = e as { status?: number; code?: string; message: string; details?: unknown };
      return new Response(JSON.stringify({ error: { code: err.code ?? 'INTERNAL', message: err.message, details: err.details } }), { status: err.status ?? 500 });
    }
  });
  setFetch(f as unknown as typeof fetch);
  return { calls, fetch: f };
}

export const httpError = (status: number, code: string, message: string, details?: unknown) => Object.assign(new Error(message), { status, code, details });

export const USER: UserDTO = { id: 'u1', email: 'zhe@example.com' };

/** 共用的背景端點（頁首的數字、對時） */
export const BASE_ROUTES = {
  'GET /time': { now: Date.UTC(2026, 9, 14, 13, 0), tz: 'Asia/Taipei', offsetMs: 0 },
  'GET /shipments': { shipments: [] },
  'GET /tomb': { sheets: [], unsent: [] },
  'GET /collection': { letters: [], stamps: [], waxes: [] },
  'GET /dev/outbox': { mails: [] },
  'GET /fonts': { fonts: [] },
  'GET /paper-templates': { templates: [] },
  'GET /letters': (_b: unknown, u: URL) => ({ letters: u.searchParams.get('status') === 'shelved' ? [] : [] }),
};

export function sheetOf(text: string, o: Partial<SheetDTO> = {}): SheetDTO {
  return {
    id: 'S1',
    kind: 'letter',
    style: 'lined',
    mode: 'type',
    font: 'typewriter',
    fontUrl: null,
    bgAttachmentId: null,
    bgTemplate: null,
    seq: text ? 1 : 0,
    chars: [...text].map((c) => ({ c, m: [] })),
    strokes: [],
    scan: null,
    createdAt: Date.UTC(2026, 9, 14, 12),
    ...o,
  };
}

export function letterOf(text: string, o: Partial<LetterDTO> = {}): LetterDTO {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'drafting',
    env: { fromName: '阿哲', fromEmail: 'zhe@example.com', fromAddr: '臺北市大安區', toName: '小雯', toEmail: 'wen@example.org', toAddr: '臺南市東區' },
    sheet: sheetOf(text),
    refs: [],
    attachments: [],
    frontAttachmentId: null,
    createdAt: Date.UTC(2026, 9, 14, 12),
    shelvedAt: null,
    askedAt: null,
    askDue: false,
    trip: null,
    ...o,
  };
}

export function counterOf(o: Partial<CounterDTO> = {}): CounterDTO {
  return {
    letterId: '11111111-1111-1111-1111-111111111111',
    env: 'post',
    envLocked: false,
    stamp: 'plum',
    stampAttachmentId: null,
    pm: 'date',
    pmAttachmentId: null,
    skinAttachmentId: null,
    stampPos: null,
    pmPos: null,
    pmAt: null,
    folds: [],
    pack: { x0: 0, y0: 0, x1: 1, y1: 1.414 },
    rot: false,
    inserted: false,
    sealed: false,
    addrOk: false,
    etxt: { from: { c: [], s: [] }, to: { c: [], s: [] } },
    emode: 'type',
    missing: ['ADDRESS', 'INSERT', 'STAMP'],
    ...o,
  };
}

export function renderPage(ui: ReactNode, path = '/', pattern = path, user: UserDTO | null = USER) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider initialUser={user}>
        <Routes>
          <Route path={pattern} element={ui} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <Modal />
      </AppProvider>
    </MemoryRouter>,
  );
}
