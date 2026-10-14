/**
 * 共用小元件：彈窗、信紙縮圖、HTML 片段、時間 hook。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { mountSheet, type PaperEnv, type ViewSheet } from '../lib/paper.ts';
import { useApp } from '../state/app.tsx';

/** 每隔 ms 重畫一次，回傳伺服器現在時間 */
export function useNow(ms = 1000): number {
  const { now } = useApp();
  const [t, setT] = useState(now);
  useEffect(() => {
    const i = setInterval(() => setT(now()), ms);
    setT(now());
    return () => clearInterval(i);
  }, [ms, now]);
  return t;
}

export function Modal() {
  const { modal, closeModal } = useApp();
  useEffect(() => {
    if (!modal) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modal.dismissable !== false) closeModal();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [modal, closeModal]);
  if (!modal) return null;
  return (
    <div
      className="modal"
      id="modal"
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (modal.dismissable !== false && (t.id === 'modal' || t.closest('[data-close]'))) closeModal();
      }}
    >
      <div className="mbox settle" id="mbox" role="dialog" aria-modal="true" key={modal.id}>
        {modal.content}
      </div>
    </div>
  );
}

/** 原型 mountSheet 的 React 包裝：縮小版的一張信紙 */
export function SheetThumb({
  sheet,
  width,
  env,
  className,
  style,
  onClick,
  after,
}: {
  sheet: ViewSheet;
  width: number;
  env?: PaperEnv | null;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  /** 掛上去之後要做的事（例如皺痕） */
  after?: (host: HTMLDivElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([sheet.id, sheet.chars.length, sheet.strokes.length, sheet.chars.reduce((a, c) => a + c.m.length, 0), sheet.style, sheet.kind, sheet.font, sheet.bg, sheet.scan, width, env?.toName, env?.toAddr, env?.toEmail]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    mountSheet(ref.current, sheet, width, env);
    after?.(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={ref} className={className} style={style} onClick={onClick} />;
}

/** 原型的 SVG／HTML 小物（內容都已經過 esc） */
export function Html({ html, className, style, as = 'div', ...rest }: { html: string; className?: string; style?: CSSProperties; as?: 'div' | 'span' } & Record<string, unknown>) {
  const Tag = as;
  return <Tag className={className} style={style} {...rest} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2 className="h2">{title}</h2>
      {children}
    </div>
  );
}
