/**
 * 書桌上的彈窗：舊信紙處理、紙本匯入的影像校正、明信片翻面、附件。
 */
import type { DiscardState } from '@manxin/shared';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SCAN, drawScan, type ScanState } from '../lib/image.ts';
import { type PaperEnv, type ViewSheet } from '../lib/paper.ts';
import { hash } from '../lib/util.ts';
import { discardMotion } from '../lib/wastepaper.ts';
import { SheetThumb } from './common.tsx';

export function RefModal({
  sheet,
  env,
  onTrash,
  onTomb,
}: {
  sheet: ViewSheet;
  env: PaperEnv;
  onTrash: (state: DiscardState) => Promise<void>;
  /** 回傳一個 promise：送去字紙冢（資料寫入）；動畫同時進行 */
  onTomb: (state: DiscardState) => Promise<boolean>;
}) {
  const [state, setState] = useState<DiscardState>('keep');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const big = useRef<HTMLDivElement>(null);
  const W = Math.min(520, innerWidth - 80);
  return (
    <>
      <div className="mhead">
        <b>舊信紙</b>
        <button type="button" className="btn small" data-close disabled={busy}>
          先留在桌邊
        </button>
      </div>
      <div className="mcenter">
        <div ref={big}>
          <SheetThumb sheet={sheet} width={W} env={env} />
        </div>
      </div>
      <div className="choice">
        <span className="label">它現在的樣子</span>
        <div className="seg" id="stSeg">
          {(
            [
              ['crumple', '揉成一團'],
              ['fold', '隨手對摺'],
              ['keep', '保持完好'],
            ] as [DiscardState, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" data-v={v} aria-pressed={state === v} disabled={busy} onClick={() => setState(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="mfoot">
        <button
          type="button"
          className={'btn' + (armed ? ' red' : '')}
          id="toTrash"
          disabled={busy}
          onClick={async () => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setBusy(true);
            await onTrash(state);
          }}
        >
          {armed ? '丟掉就找不回來了。確定丟？' : '丟進垃圾桶'}
        </button>
        <button
          type="button"
          className="btn primary"
          id="toTomb"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const a = Math.round((hash(sheet.id) % 70) - 35);
            const [ok] = await Promise.all([onTomb(state), big.current ? discardMotion(big.current, state, a) : Promise.resolve()]);
            if (!ok) setBusy(false);
          }}
        >
          送去字紙冢
        </button>
      </div>
    </>
  );
}

export function ScanEditor({ img, onOk }: { img: HTMLCanvasElement; onOk: (out: HTMLCanvasElement) => Promise<void> }) {
  const [st, setSt] = useState<ScanState>(DEFAULT_SCAN);
  const [busy, setBusy] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (cv.current) drawScan(cv.current, img, st, 640);
  }, [img, st]);
  const set = (p: Partial<ScanState>) => setSt((s) => ({ ...s, ...p }));
  return (
    <>
      <div className="mhead">
        <b>匯入紙本・影像校正</b>
        <button type="button" className="btn small" data-close>
          取消
        </button>
      </div>
      <canvas className="scan-cv" ref={cv} />
      <div className="ctrls">
        <label>
          微調角度 <input type="range" min="-15" max="15" step=".5" value={st.fine} onChange={(e) => set({ fine: +e.target.value })} />
        </label>
        <label>
          亮度 <input type="range" min="60" max="160" value={st.br} onChange={(e) => set({ br: +e.target.value })} />
        </label>
        <label>
          對比 <input type="range" min="60" max="220" value={st.ct} onChange={(e) => set({ ct: +e.target.value })} />
        </label>
        <label>
          裁掉邊緣 <input type="range" min="0" max="18" value={st.crop} onChange={(e) => set({ crop: +e.target.value })} />
        </label>
      </div>
      <div className="mfoot" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn small" onClick={() => set({ rot: (st.rot + 90) % 360 })}>
            轉 90°
          </button>
          <label className="btn small">
            <input type="checkbox" checked={st.bw} onChange={(e) => set({ bw: e.target.checked })} /> 白紙化
          </label>
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const o = document.createElement('canvas');
            drawScan(o, img, st, 1400);
            await onOk(o);
            setBusy(false);
          }}
        >
          放上書桌
        </button>
      </div>
    </>
  );
}

/** 明信片：正面圖片與背面（信紙）翻來翻去 */
export function FlipCard({ front, sheet, env, title = '明信片' }: { front: string | null; sheet: ViewSheet; env: PaperEnv; title?: string }) {
  const [flipped, setFlipped] = useState(false);
  const W = Math.min(560, innerWidth - 80),
    H = Math.round((W * 2) / 3);
  return (
    <>
      <div className="mhead">
        <b>{title}</b>
        <button type="button" className="btn small" data-close>
          放下
        </button>
      </div>
      <div className={'flipcard' + (flipped ? ' flipped' : '')} style={{ width: W }}>
        <div className="in" style={{ height: H }}>
          <div className="sidef" style={{ height: H, backgroundImage: front ? `url(${front})` : undefined }}>
            {front ? null : (
              <span className="hint" style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                （正面沒有圖片）
              </span>
            )}
          </div>
          <div className="sideb">
            <SheetThumb sheet={sheet} width={W} env={env} />
          </div>
        </div>
      </div>
      <div className="mfoot">
        <button type="button" className="btn primary" onClick={() => setFlipped((f) => !f)}>
          翻面
        </button>
      </div>
    </>
  );
}

export function ImageModal({ src, title = '附件' }: { src: string; title?: string }) {
  return (
    <>
      <div className="mhead">
        <b>{title}</b>
        <button type="button" className="btn small" data-close>
          關閉
        </button>
      </div>
      <img src={src} alt="附件照片" style={{ width: '100%', borderRadius: 4 }} />
    </>
  );
}

export function Confirm({ title, body, cancel, ok, onOk }: { title: string; body: string; cancel: string; ok: string; onOk: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="mhead">
        <b>{title}</b>
      </div>
      <p style={{ margin: 0 }}>{body}</p>
      <div className="mfoot">
        <button type="button" className="btn" data-close disabled={busy}>
          {cancel}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onOk();
            } finally {
              setBusy(false);
            }
          }}
        >
          {ok}
        </button>
      </div>
    </>
  );
}
