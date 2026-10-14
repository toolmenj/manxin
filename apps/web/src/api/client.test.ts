import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, fileUrl, isApiError, recvAttachmentUrl, request, setFetch } from './client.ts';

type Call = { url: string; init: RequestInit };

function mockFetch(status: number, body?: unknown) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  setFetch(f as unknown as typeof fetch);
  return calls;
}

const headers = (c: Call) => c.init.headers as Record<string, string>;

afterEach(() => setFetch((...a) => fetch(...a)));

describe('API client', () => {
  it('一律走 /api 前綴（Vite proxy 去掉前綴再轉給後端），帶 cookie', async () => {
    const calls = mockFetch(200, { now: 1, tz: 'Asia/Taipei' });
    await api.time();
    expect(calls[0]!.url).toBe('/api/time');
    expect(calls[0]!.init.credentials).toBe('same-origin');
  });

  it('沒有 body 的 POST 不帶 content-type（Fastify 會把空 body 當錯誤）', async () => {
    const calls = mockFetch(200, {});
    await api.transcribe('abc');
    expect(calls[0]!.url).toBe('/api/letters/abc/transcribe');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBeUndefined();
    expect(headers(calls[0]!)['content-type']).toBeUndefined();
  });

  it('JSON body：帶 content-type，內容正確', async () => {
    const calls = mockFetch(201, { seq: 3 });
    await api.appendChars('L1', '你好', 2);
    expect(calls[0]!.url).toBe('/api/letters/L1/sheet/chars');
    expect(headers(calls[0]!)['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ text: '你好', seq: 2 });
  });

  it('書寫只有追加：標記與筆畫也是 POST，沒有任何修改或刪除內容的函式', async () => {
    const calls = mockFetch(201, {});
    await api.appendMark('L1', 0, 3, 's2', 5);
    await api.appendStroke('L1', { pen: 'ball', color: '#1A1A1A', pts: [[0.1, 0.2, 0.5]] });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', '/api/letters/L1/sheet/marks'],
      ['POST', '/api/letters/L1/sheet/strokes'],
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: 0, to: 3, tool: 's2', seq: 5 });
    const names = Object.keys(api).join(' ');
    expect(names).not.toMatch(/delete|remove|undo|erase|update(Chars|Sheet|Text)/i);
  });

  it('錯誤轉成 ApiError，帶 code、details、reason', async () => {
    mockFetch(422, { error: { code: 'INVALID_OP', message: '信紙寫滿了', details: { reason: 'SHEET_FULL' } } });
    const e = await api.appendChars('L1', 'x').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(422);
    expect(e.code).toBe('INVALID_OP');
    expect(e.message).toBe('信紙寫滿了');
    expect(e.reason).toBe('SHEET_FULL');
    expect(isApiError(e, 'INVALID_OP')).toBe(true);
    expect(isApiError(e, 'SEQ_CONFLICT')).toBe(false);
  });

  it('裝不下信封：TOO_LONG／TOO_WIDE 的訊息原樣交給畫面', async () => {
    mockFetch(422, { error: { code: 'TOO_LONG', message: '塞不進去。信紙太長了，要再摺。', details: { w: 1, h: 1.414, envW: 1.05, envH: 0.52 } } });
    const e = (await api.insert('L1').catch((x) => x)) as ApiError;
    expect(e.code).toBe('TOO_LONG');
    expect(e.message).toContain('太長');
  });

  it('204 回 undefined', async () => {
    mockFetch(204);
    await expect(api.goHome('L1')).resolves.toBeUndefined();
  });

  it('伺服器回的不是 JSON 也不會炸', async () => {
    mockFetch(502, '<html>bad gateway</html>');
    const e = (await request('GET', '/time').catch((x) => x)) as ApiError;
    expect(e.status).toBe(502);
    expect(e.code).toBe('INTERNAL');
  });

  it('連不上：NETWORK', async () => {
    setFetch((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    const e = (await api.time().catch((x) => x)) as ApiError;
    expect(e.code).toBe('NETWORK');
    expect(e.status).toBe(0);
  });

  it('上傳用 multipart，不自己設 content-type（交給瀏覽器帶 boundary）', async () => {
    const calls = mockFetch(201, { id: 'a' });
    await api.upload('L1', new Blob(['x'], { type: 'image/jpeg' }), 'stamp', 's.jpg');
    expect(calls[0]!.url).toBe('/api/letters/L1/attachments?purpose=stamp');
    expect(calls[0]!.init.body).toBeInstanceOf(FormData);
    expect(headers(calls[0]!)['content-type']).toBeUndefined();
  });

  it('開信連結、單號會做 URL 編碼；檔案網址補上 /api', async () => {
    const calls = mockFetch(200, {});
    await api.recv('abc_DEF-123');
    await api.track('RR123456789TW');
    expect(calls.map((c) => c.url)).toEqual(['/api/r/abc_DEF-123', '/api/track/RR123456789TW']);
    expect(fileUrl('/r/t/attachments/x')).toBe('/api/r/t/attachments/x');
    expect(fileUrl('/api/attachments/x')).toBe('/api/attachments/x');
    expect(recvAttachmentUrl('tok', 'id1')).toBe('/api/r/tok/attachments/id1');
  });

  it('快轉（開發用）：POST /dev/clock { advanceMs }', async () => {
    const calls = mockFetch(200, { now: 1, offsetMs: 3600000, jobs: [] });
    await api.dev.advance(3600000);
    expect(calls[0]!.url).toBe('/api/dev/clock');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ advanceMs: 3600000 });
  });
});
