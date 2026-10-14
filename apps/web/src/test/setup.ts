/**
 * Vitest + jsdom 的補丁：jsdom 沒有 Web Animations、ResizeObserver、canvas、matchMedia、pointer capture。
 * 這些只影響畫面表現，測試裡換成什麼都不做的版本。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

const fakeAnimation = () =>
  ({
    finished: Promise.resolve(),
    cancel() {},
    finish() {},
    reverse() {},
    play() {},
    pause() {},
    effect: { getTiming: () => ({ iterations: 1 }) },
  }) as unknown as Animation;

if (!Element.prototype.animate) Element.prototype.animate = function () {
  return fakeAnimation();
};
if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
if (!(document as unknown as { getAnimations?: unknown }).getAnimations) (document as unknown as { getAnimations: () => Animation[] }).getAnimations = () => [];
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

if (!window.matchMedia)
  window.matchMedia = (q: string) =>
    ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;

// canvas：jsdom 沒有實作，回傳 null（畫墨跡的程式會略過）
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
HTMLCanvasElement.prototype.toDataURL = () => '';

if (!document.elementFromPoint) document.elementFromPoint = () => null;
