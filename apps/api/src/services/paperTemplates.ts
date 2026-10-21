/**
 * 信紙圖樣範本庫（內建）。全部用 SVG 畫，不抓外部圖片、不用外部字型。
 * 前端當成信紙背景（background-size: cover），所以畫面中間要淡，字才看得清楚；
 * 不畫和字距對齊的橫線（打字機行高會隨畫面縮放，對不齊），以花紋、邊框、底紋為主。
 */
import type { PaperTemplateDTO } from '@manxin/shared';

/** 和信紙同比例（1 : 1.414）；明信片會從中間裁成 3 : 2 */
const W = 600;
const H = 848;

interface Tpl {
  id: string;
  name: string;
  era: PaperTemplateDTO['era'];
  note: string;
  /** 底色 */
  paper: string;
  body: () => string;
}

const svg = (paper: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="${paper}"/>${body}</svg>`;

/** 小碎花：五瓣 + 花心 */
const flower = (x: number, y: number, r: number, petal: string, core: string, rot = 0) =>
  `<g transform="translate(${x} ${y}) rotate(${rot})">${[0, 72, 144, 216, 288]
    .map((a) => `<ellipse cx="0" cy="${-r}" rx="${r * 0.62}" ry="${r}" fill="${petal}" transform="rotate(${a})"/>`)
    .join('')}<circle r="${r * 0.45}" fill="${core}"/></g>`;

/** 圓形郵戳（不帶文字，只有圈與日期框） */
const postmark = (x: number, y: number, r: number, rot: number, c: string) =>
  `<g transform="translate(${x} ${y}) rotate(${rot})" fill="none" stroke="${c}" stroke-width="2.2"><circle r="${r}"/><circle r="${r * 0.68}"/><line x1="${-r * 0.82}" y1="-7" x2="${r * 0.82}" y2="-7"/><line x1="${-r * 0.82}" y1="7" x2="${r * 0.82}" y2="7"/><path d="M${r + 6} -14 q16 -8 32 0 t32 0 t32 0 M${r + 6} 0 q16 -8 32 0 t32 0 t32 0 M${r + 6} 14 q16 -8 32 0 t32 0 t32 0"/></g>`;

/** 竹葉：一片長葉 */
const leaf = (x: number, y: number, len: number, rot: number, c: string) =>
  `<path transform="translate(${x} ${y}) rotate(${rot})" d="M0 0 Q${len * 0.35} ${-len * 0.13} ${len} 0 Q${len * 0.35} ${len * 0.13} 0 0Z" fill="${c}"/>`;

/** 民國花箋的回紋角飾 */
const fret = (x: number, y: number, sx: number, sy: number, c: string) =>
  `<path transform="translate(${x} ${y}) scale(${sx} ${sy})" d="M0 0 H44 V30 H14 V14 H30 M0 0 V44 H30 V14" fill="none" stroke="${c}" stroke-width="2.4"/>`;

const TEMPLATES: Tpl[] = [
  {
    id: 'airmail80',
    name: '航空信紙',
    era: '80s',
    note: '八〇年代的航空信紙，紅藍斜紋滾邊、淡藍薄紙',
    paper: '#EEF3F6',
    body: () =>
      `<defs><pattern id="am" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="40" fill="#C0392B"/><rect x="20" width="10" height="40" fill="#2C4F8C"/></pattern></defs>
<path fill="url(#am)" fill-rule="evenodd" opacity=".85" d="M0 0H${W}V${H}H0Z M14 14V${H - 14}H${W - 14}V14Z"/>
<g fill="#2C4F8C" opacity=".55"><rect x="${W - 150}" y="38" width="110" height="24" rx="3" fill="none" stroke="#2C4F8C" stroke-width="2"/><path d="M${W - 138} 50 l18 -6 l-6 6 l6 6Z"/><rect x="${W - 112}" y="47" width="62" height="6" rx="3"/></g>`,
  },
  {
    id: 'pastel80',
    name: '粉彩信紙',
    era: '80s',
    note: '文具店賣的粉彩信紙，上緣點點與小愛心',
    paper: '#FBF0F0',
    body: () =>
      `<defs><pattern id="pd" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="3.2" fill="#E8A3B0"/></pattern></defs>
<rect width="${W}" height="72" fill="url(#pd)" opacity=".7"/><rect y="72" width="${W}" height="3" fill="#E8A3B0" opacity=".7"/>
<rect y="${H - 46}" width="${W}" height="46" fill="url(#pd)" opacity=".45"/>
${[
  [W - 70, 110, 1],
  [W - 44, 140, 0.7],
  [56, H - 92, 0.8],
]
  .map(([x, y, s]) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 8 C-14 -6 -26 10 0 28 C26 10 14 -6 0 8Z" fill="#D9707F" opacity=".55"/>`)
  .join('')}`,
  },
  {
    id: 'graph80',
    name: '方格紙',
    era: '80s',
    note: '淡綠的方格計算紙，五格一粗線',
    paper: '#F5F7EF',
    body: () =>
      `<defs><pattern id="g1" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#9DBF9A" stroke-width=".8"/></pattern>
<pattern id="g5" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#7DA67A" stroke-width="1.6"/></pattern></defs>
<rect width="${W}" height="${H}" fill="url(#g1)" opacity=".6"/><rect width="${W}" height="${H}" fill="url(#g5)" opacity=".5"/>`,
  },
  {
    id: 'postmark',
    name: '郵戳底紋',
    era: '80s',
    note: '淡淡蓋滿郵戳與波浪銷印線',
    paper: '#F6F1E6',
    body: () =>
      `<g opacity=".16">${[
        [90, 90, -12],
        [430, 150, 18],
        [220, 330, -4],
        [470, 470, 9],
        [70, 560, 24],
        [300, 700, -20],
        [500, 790, 6],
      ]
        .map(([x, y, r]) => postmark(x!, y!, 36, r!, '#3B4A6B'))
        .join('')}</g>`,
  },
  {
    id: 'floral',
    name: '碎花',
    era: '80s',
    note: '小碎花散在四周，中間留白',
    paper: '#FBF6EC',
    body: () => {
      const pts: [number, number, number][] = [];
      // 決定性的散布，避開中間書寫區
      let s = 7;
      const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 70; i++) {
        const x = rnd() * W,
          y = rnd() * H;
        const inside = x > 70 && x < W - 70 && y > 90 && y < H - 90;
        if (inside && rnd() > 0.12) continue;
        pts.push([x, y, rnd() * 72]);
      }
      const cols = ['#E29A8E', '#E7C16A', '#9FB7D9'];
      return `<g opacity=".5">${pts
        .map(([x, y, r], i) => flower(x, y, 6 + (i % 3) * 1.5, cols[i % 3]!, '#B9644E', r))
        .join('')}${pts.map(([x, y], i) => leaf(x + 9, y + 6, 14, 30 + (i % 5) * 20, '#8DAA7B')).join('')}</g>`;
    },
  },
  {
    id: 'bamboo',
    name: '竹葉箋',
    era: 'minguo',
    note: '左側一枝墨竹，淡綠宣紙色',
    paper: '#F3F2E4',
    body: () =>
      `<g opacity=".42"><g stroke="#5E7D4E" stroke-width="7" stroke-linecap="round">${[0, 1, 2, 3, 4]
        .map((i) => `<line x1="${42 + i * 2}" y1="${H - i * 170}" x2="${44 + (i + 1) * 2}" y2="${H - (i + 1) * 170 + 8}"/>`)
        .join('')}</g>
${[
  [50, 700, 90, -20],
  [52, 690, 80, 25],
  [55, 520, 110, -35],
  [56, 515, 90, 10],
  [58, 350, 100, -15],
  [59, 345, 80, 38],
  [61, 180, 95, -28],
  [62, 175, 70, 18],
]
  .map(([x, y, l, r]) => leaf(x!, y!, l!, r!, '#5E7D4E'))
  .join('')}</g>`,
  },
  {
    id: 'waves',
    name: '水波紋',
    era: 'minguo',
    note: '青海波，下緣一抹水色',
    paper: '#F1F4F2',
    body: () =>
      `<defs><pattern id="sg" width="60" height="30" patternUnits="userSpaceOnUse"><g fill="#F1F4F2" stroke="#6E98A8" stroke-width="1.4">${[0, 60, 30]
        .map((x, i) => {
          const y = i === 2 ? 15 : 30;
          return `<g transform="translate(${x} ${y})"><circle r="30"/><circle r="22"/><circle r="14"/><circle r="6"/></g>`;
        })
        .join('')}</g></pattern></defs>
<rect y="${H - 220}" width="${W}" height="220" fill="url(#sg)" opacity=".45"/>
<rect y="${H - 260}" width="${W}" height="60" fill="#F1F4F2" opacity=".6"/>`,
  },
  {
    id: 'huajian',
    name: '民國花箋',
    era: 'minguo',
    note: '朱紅雙框、四角回紋，舊時文人用的花箋',
    paper: '#F5EBD6',
    body: () =>
      `<g opacity=".6"><rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="#B5482F" stroke-width="3"/><rect x="32" y="32" width="${W - 64}" height="${H - 64}" fill="none" stroke="#B5482F" stroke-width="1.2"/>
${fret(40, 40, 1, 1, '#B5482F')}${fret(W - 40, 40, -1, 1, '#B5482F')}${fret(40, H - 40, 1, -1, '#B5482F')}${fret(W - 40, H - 40, -1, -1, '#B5482F')}</g>`,
  },
  {
    id: 'plum',
    name: '梅花箋',
    era: 'minguo',
    note: '右下一枝老梅，米色箋紙',
    paper: '#F6EEDD',
    body: () =>
      `<g opacity=".5"><path d="M${W} ${H - 40} C${W - 90} ${H - 70} ${W - 150} ${H - 130} ${W - 230} ${H - 150} M${W - 150} ${H - 112} C${W - 170} ${H - 180} ${W - 160} ${H - 230} ${W - 190} ${H - 290} M${W - 90} ${H - 64} C${W - 80} ${H - 120} ${W - 50} ${H - 150} ${W - 60} ${H - 210}" fill="none" stroke="#4A3428" stroke-width="6" stroke-linecap="round"/>
${[
  [W - 230, H - 150],
  [W - 205, H - 140],
  [W - 190, H - 290],
  [W - 172, H - 230],
  [W - 60, H - 210],
  [W - 70, H - 160],
  [W - 120, H - 95],
]
  .map(([x, y], i) => flower(x!, y!, 9, '#C9566A', '#E9C46A', i * 23))
  .join('')}</g>`,
  },
  {
    id: 'cloud',
    name: '祥雲箋',
    era: 'minguo',
    note: '上下緣淡金色雲紋',
    paper: '#F7F0DF',
    body: () => {
      const c = (x: number, y: number, s: number) =>
        `<path transform="translate(${x} ${y}) scale(${s})" d="M0 20 C-4 6 12 -2 20 8 C24 -6 44 -6 46 8 C56 0 70 10 62 22 Z M14 20 C14 12 24 12 24 18" fill="none" stroke="#B08A3E" stroke-width="2.4" stroke-linecap="round"/>`;
      return `<g opacity=".5">${[30, 150, 270, 390, 510].map((x, i) => c(x, 26 + (i % 2) * 12, 1.1)).join('')}${[0, 120, 240, 360, 480]
        .map((x, i) => c(x + 20, H - 70 - (i % 2) * 12, 1.1))
        .join('')}</g>`;
    },
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
const CACHE = new Map<string, string>();

export const templateUrl = (id: string) => `/paper-templates/${id}.svg`;

export function listTemplates(): PaperTemplateDTO[] {
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, era: t.era, note: t.note, url: templateUrl(t.id) }));
}

export const isTemplate = (id: string): boolean => BY_ID.has(id);

export function templateSvg(id: string): string | null {
  const t = BY_ID.get(id);
  if (!t) return null;
  let s = CACHE.get(id);
  if (!s) {
    s = svg(t.paper, t.body().replace(/\n/g, ''));
    CACHE.set(id, s);
  }
  return s;
}
