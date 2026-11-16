/**
 * 產生拼音鍵盤的詞組資料（src/lib/pinyin-phrases.json）。只在要更新詞庫時執行，結果進版控。
 *
 *   curl -L -o /tmp/dict.txt https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt
 *   node apps/web/scripts/gen-pinyin-phrases.mjs /tmp/dict.txt
 *
 * 資料來源：
 * - 詞與詞頻：結巴分詞的詞典 dict.txt（MIT，https://github.com/fxsjy/jieba）
 * - 讀音：pinyin-pro（MIT），有詞語讀音表，多音字比照常用讀法
 *
 * 輸出格式：{ "nihao": "你好 泥号 …" }，同一串拼音的詞依詞頻排，空白分隔。只收 2～4 個字、全是漢字的詞。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

const src = process.argv[2];
if (!src) {
  console.error('用法：node gen-pinyin-phrases.mjs <jieba dict.txt>');
  process.exit(1);
}
const TOP = Number(process.env.TOP ?? 30000);
const PER_KEY = 6;

const words = [];
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const [w, f] = line.trim().split(/\s+/);
  if (!w || !f) continue;
  const n = [...w].length;
  if (n < 2 || n > 4 || !/^[一-鿿]+$/.test(w)) continue;
  words.push([w, Number(f)]);
}
words.sort((a, b) => b[1] - a[1]);

const out = {};
let kept = 0;
for (const [w] of words) {
  if (kept >= TOP) break;
  const key = pinyin(w, { toneType: 'none', type: 'array', v: true }).join('').toLowerCase();
  if (!/^[a-z]+$/.test(key)) continue;
  const list = (out[key] ??= []);
  if (list.length >= PER_KEY || list.includes(w)) continue;
  list.push(w);
  kept++;
}
const json = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join(' ')]));
const dest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/pinyin-phrases.json');
writeFileSync(dest, JSON.stringify(json));
console.log(`詞組 ${kept} 個、拼音 ${Object.keys(json).length} 組 → ${dest}`);
