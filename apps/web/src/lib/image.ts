/**
 * 圖片：讀進來、縮小、轉成 JPEG（原型 readImg），以及紙本匯入的影像校正（原型 openScanEditor 的 draw）。
 */

export interface ScanState {
  rot: number;
  fine: number;
  br: number;
  ct: number;
  bw: boolean;
  crop: number;
}

export const DEFAULT_SCAN: ScanState = { rot: 0, fine: 0, br: 105, ct: 115, bw: true, crop: 2 };

export function readImg(file: Blob, max = 1400): Promise<HTMLCanvasElement> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const s = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * s);
        c.height = Math.round(im.height * s);
        c.getContext('2d')?.drawImage(im, 0, 0, c.width, c.height);
        res(c);
      };
      im.onerror = () => rej(new Error('這張圖讀不出來。'));
      im.src = String(fr.result);
    };
    fr.onerror = () => rej(new Error('這張圖讀不出來。'));
    fr.readAsDataURL(file);
  });
}

export function toJpeg(c: HTMLCanvasElement, q = 0.85): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('圖片轉檔失敗'))), 'image/jpeg', q));
}

/** 影像校正：旋轉、微調角度、亮度、對比、裁邊、白紙化 */
export function drawScan(c: HTMLCanvasElement, img: HTMLCanvasElement, st: ScanState, maxW: number): void {
  const rad = ((st.rot + st.fine) * Math.PI) / 180,
    cx = (img.width * st.crop) / 100,
    cy = (img.height * st.crop) / 100,
    w = img.width - 2 * cx,
    h = img.height - 2 * cy,
    q = st.rot % 180 !== 0,
    ow = q ? h : w,
    oh = q ? w : h,
    s = Math.min(1, maxW / ow);
  c.width = Math.round(ow * s);
  c.height = Math.round(oh * s);
  const x = c.getContext('2d');
  if (!x) return;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.filter = `brightness(${st.br}%) contrast(${st.ct}%)${st.bw ? ' grayscale(1)' : ''}`;
  x.translate(c.width / 2, c.height / 2);
  x.rotate(rad);
  x.scale(s, s);
  x.drawImage(img, cx, cy, w, h, -w / 2, -h / 2, w, h);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.filter = 'none';
}
