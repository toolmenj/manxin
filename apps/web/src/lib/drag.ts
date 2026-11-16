/**
 * 拖著東西走：郵票、郵戳、整個信封（移植自原型 dragPiece）。沒有輔助線，放開就算數。
 */
import { anim, INOUT } from './motion.ts';
import { el, jit } from './util.ts';

export function dragPiece(
  src: HTMLElement,
  e: PointerEvent | React.PointerEvent,
  html: string,
  /** cx, cy：拖著的東西的中心；px, py：放開時手指（滑鼠）的位置 */
  onDrop: (cx: number, cy: number, ghost: HTMLElement, px: number, py: number) => Promise<boolean> | boolean,
  prepare?: (ghost: HTMLElement) => void,
): void {
  e.preventDefault();
  const r = src.getBoundingClientRect();
  const g = el('div', 'dragghost', html);
  g.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;z-index:95;pointer-events:none;transform:rotate(${jit(4).toFixed(1)}deg)`;
  document.body.append(g);
  prepare?.(g);
  const ox = e.clientX - r.left,
    oy = e.clientY - r.top;
  src.style.visibility = 'hidden';
  let px = e.clientX,
    py = e.clientY;
  const mv = (ev: PointerEvent) => {
    px = ev.clientX;
    py = ev.clientY;
    g.style.left = ev.clientX - ox + 'px';
    g.style.top = ev.clientY - oy + 'px';
  };
  const upf = async () => {
    removeEventListener('pointermove', mv);
    removeEventListener('pointerup', upf);
    removeEventListener('pointercancel', upf);
    const gr = g.getBoundingClientRect();
    let ok = false;
    try {
      ok = await onDrop(gr.left + gr.width / 2, gr.top + gr.height / 2, g, px, py);
    } catch {
      ok = false;
    }
    if (!ok) {
      await anim(g, [{ left: g.style.left, top: g.style.top }, { left: r.left + 'px', top: r.top + 'px' }], { d: 450, e: INOUT });
      if (src.isConnected) src.style.visibility = '';
    }
    g.remove();
  };
  addEventListener('pointermove', mv);
  addEventListener('pointerup', upf);
  addEventListener('pointercancel', upf);
}
