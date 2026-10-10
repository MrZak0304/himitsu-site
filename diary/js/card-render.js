// 「きょうの1枚カード」の canvas 描画(v1.1 U2)。レイアウトは core/card.js(ピュア)で計算し、
// ここは描くだけ。フォントはシステムフォント(不変条件7: 外部フォントを使わない)。
// 生成は端末内で完結し、共有は backup-io.js の deliverFile(OS の共有シート)で行う。
// プレビュー(card-dialog.js)と本番出力(PNG)で同じ drawCard を使う=見たままが出る。

import { layoutCard, photoSourceRect, stickerRect, stampSize, imageStampSize, CARD_SIZE, HANDLE_OFFSET, HANDLE_R } from './core/card.js';
import { resolveStampColors } from './core/stamp.js';

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", Roboto, sans-serif';

function font(size, weight = 700) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function alphaHex(a) {
  return Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
}

// Blob → 描画できる画像(ImageBitmap か Image)
export async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('写真を読み込めませんでした。'));
    };
    img.src = url;
  });
}

// 現在のテーマ色(CSS 変数)を読む。カードの配色はアプリの見た目と揃える
export function currentThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return { bg: get('--bg', '#f7f6f2'), accent: get('--accent', '#4a7dbd'), fg: get('--text', '#2b2925') };
}

// スタンプの形(v1.05・タグスタンプ設定)。(x,y,w,h) の矩形に収まる輪郭を path にする
function shapePath(ctx, x, y, w, h, shape, r) {
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  if (shape === 'ribbon') {
    const notch = Math.min(h * 0.32, w * 0.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - notch, y + h / 2);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + notch, y + h / 2);
    ctx.closePath();
    return;
  }
  if (shape === 'zigzag') {
    const tooth = 12;
    const amp = 6;
    const nx = Math.max(2, Math.round(w / tooth));
    const ny = Math.max(2, Math.round(h / tooth));
    const sx = w / nx;
    const sy = h / ny;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < nx; i += 1) { ctx.lineTo(x + sx * (i + 0.5), y - amp); ctx.lineTo(x + sx * (i + 1), y); }
    for (let i = 0; i < ny; i += 1) { ctx.lineTo(x + w + amp, y + sy * (i + 0.5)); ctx.lineTo(x + w, y + sy * (i + 1)); }
    for (let i = nx; i > 0; i -= 1) { ctx.lineTo(x + sx * (i - 0.5), y + h + amp); ctx.lineTo(x + sx * (i - 1), y + h); }
    for (let i = ny; i > 0; i -= 1) { ctx.lineTo(x - amp, y + sy * (i - 0.5)); ctx.lineTo(x, y + sy * (i - 1)); }
    ctx.closePath();
    return;
  }
  roundRect(ctx, x, y, w, h, r);
}

// ハンコ風のタグ(二重枠・傾き・インクはテーマ色)。box = {cx, cy, w, h, rotate}。
// orient 'v' は文字を縦に積む(縦書き風)。highlight は編集中の選択枠(プレビューのみ)
// box は中心・等倍の幅高さ・回転。scale でハンコ全体(枠・文字)を拡大縮小する(PD FB 5)
// stamp(v1.05): タグごとのスタンプ設定(null=既定)。内蔵はインク色・透過度・形、画像は bitmap をそのまま貼る
function drawStamp(ctx, box, text, colors, { orient = 'h', fontSize = 52, highlight = false, scale = 1, stamp = null, bitmap = null } = {}) {
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(((box.rotate ?? 0) * Math.PI) / 180);
  ctx.scale(scale, scale);
  const x = -box.w / 2;
  const y = -box.h / 2;
  const r = 18;
  if (stamp?.type === 'image' && bitmap) {
    ctx.drawImage(bitmap, x, y, box.w, box.h);
  } else {
    const st = resolveStampColors(stamp, { accent: colors.stampInk });
    const shape = stamp?.type === 'builtin' ? stamp.shape : 'round';
    // 「まる」は文字の角が欠けないよう箱より少し大きく描く
    const grow = shape === 'circle' ? { x: box.w * 0.08, y: box.h * 0.22 } : { x: 0, y: 0 };
    const bx = x - grow.x;
    const by = y - grow.y;
    const bw = box.w + grow.x * 2;
    const bh = box.h + grow.y * 2;
    ctx.globalAlpha = st.alpha;
    if (!st.transparent) {
      ctx.fillStyle = colors.chipBg;
      shapePath(ctx, bx, by, bw, bh, shape, r);
      ctx.fill();
      // 外枠(太)+内枠(細)の二重線でハンコらしさを出す
      ctx.strokeStyle = st.ink;
      ctx.lineWidth = 6;
      shapePath(ctx, bx, by, bw, bh, shape, r);
      ctx.stroke();
      ctx.lineWidth = 2;
      shapePath(ctx, bx + 9, by + 9, bw - 18, bh - 18, shape === 'zigzag' ? 'round' : shape, r - 8);
      ctx.stroke();
    }
    ctx.fillStyle = st.ink;
    ctx.font = font(fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawStampText(ctx, text, orient, fontSize, box.w);
    ctx.globalAlpha = 1;
  }
  drawStampHighlight(ctx, box, colors, scale, r, highlight);
  ctx.restore();
}

function drawStampText(ctx, text, orient, fontSize, boxW) {
  if (orient === 'v') {
    const chars = [...text];
    const step = fontSize * 1.05;
    const start = -((chars.length - 1) * step) / 2;
    chars.forEach((ch, i) => {
      // 長音・伸ばし棒は縦書きで縦向きにする
      if (ch === 'ー' || ch === '〜' || ch === '-') {
        ctx.save();
        ctx.translate(0, start + i * step + 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(ch, 0, start + i * step + 2);
      }
    });
  } else {
    ctx.fillText(text, 0, 2, boxW - 36);
  }
}

// 選択枠とつまみは拡大率に関係なく同じ太さ・大きさで描く(等倍座標に戻す)
function drawStampHighlight(ctx, box, colors, scale, r, highlight) {
  if (highlight) {
    ctx.scale(1 / scale, 1 / scale);
    const sw = box.w * scale;
    const sh = box.h * scale;
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = colors.stampInk;
    ctx.lineWidth = 4;
    roundRect(ctx, -sw / 2 - 10, -sh / 2 - 10, sw + 20, sh + 20, r + 6);
    ctx.stroke();
    // 回転・拡大つまみ(右上角の外側)。core/card.js の stickerHandlePoint と同じ位置
    const hx = sw / 2 + HANDLE_OFFSET;
    const hy = -sh / 2 - HANDLE_OFFSET;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(sw / 2 + 10, -sh / 2 - 10);
    ctx.lineTo(hx, hy);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = colors.chipBg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.stroke();
    // つまみの中に回転の矢印(円弧+矢先)
    ctx.beginPath();
    ctx.arc(hx, hy, HANDLE_R * 0.5, Math.PI * 0.2, Math.PI * 1.6);
    ctx.lineWidth = 3.5;
    ctx.stroke();
    const ax = hx + HANDLE_R * 0.5 * Math.cos(Math.PI * 1.6);
    const ay = hy + HANDLE_R * 0.5 * Math.sin(Math.PI * 1.6);
    ctx.beginPath();
    ctx.moveTo(ax - 7, ay - 7);
    ctx.lineTo(ax + 1, ay + 1);
    ctx.lineTo(ax - 8, ay + 5);
    ctx.stroke();
  }
}

// canvas にカードを描く。bitmap は loadBitmap 済みの写真(null なら写真なし)。
// crop は {cx, cy, zoom}(core/card.js の photoSourceRect)。
// stickers を渡すとタグはシールとして自由配置で描く(省略時は自動配置)。highlightIndex は編集中の選択
export function drawCard(canvas, { dateKey, tagNames, bitmap = null, crop, theme, stickers = null, highlightIndex = -1, stampBitmaps = null }) {
  const layout = layoutCard({ dateKey, tagNames, hasPhoto: !!bitmap, theme });
  const { size } = layout;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // 背景
  if (layout.background.kind === 'photo') {
    const { sx, sy, sw, sh } = photoSourceRect(bitmap.width, bitmap.height, crop ?? {});
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, size, size);
  } else {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, layout.background.from);
    g.addColorStop(1, layout.background.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // 下部の膜(文字の可読性)。文字より十分上からなだらかに
  const sg = ctx.createLinearGradient(0, layout.scrim.y, 0, size);
  const sc = layout.colors.scrim;
  sg.addColorStop(0, `${sc}00`);
  sg.addColorStop(0.25, `${sc}${alphaHex(layout.scrim.alpha * 0.35)}`);
  sg.addColorStop(0.55, `${sc}${alphaHex(layout.scrim.alpha)}`);
  sg.addColorStop(1, `${sc}${alphaHex(layout.scrim.alpha + 0.2)}`);
  ctx.fillStyle = sg;
  ctx.fillRect(0, layout.scrim.y, size, layout.scrim.h);

  // タグ(ハンコ風)。シール配列があればその位置・向き・回転で、無ければ自動配置
  if (stickers) {
    stickers.forEach((st, i) => {
      const rect = stickerRect(st, size);
      const box = { cx: rect.cx, cy: rect.cy, w: rect.baseW, h: rect.baseH, rotate: rect.rotate };
      const stamp = st.stamp ?? null;
      const sbmp = stamp?.type === 'image' ? stampBitmaps?.get(stamp.imageId) ?? null : null;
      drawStamp(ctx, box, st.text, layout.colors, { orient: st.orient, highlight: i === highlightIndex, scale: rect.scale, stamp, bitmap: sbmp });
    });
  } else {
    for (const row of layout.tagRows) {
      for (const chip of row.chips) {
        drawStamp(ctx, { cx: chip.x + chip.w / 2, cy: chip.y + chip.h / 2, w: chip.w, h: chip.h, rotate: chip.rotate }, chip.text, layout.colors, { fontSize: chip.fontSize });
      }
    }
  }

  // 日付・ブランド
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = layout.colors.text;
  ctx.font = font(layout.date.fontSize);
  ctx.fillText(layout.date.text, layout.date.x, layout.date.y);
  ctx.fillStyle = layout.colors.brand;
  ctx.font = font(layout.brand.fontSize, 600);
  ctx.fillText(layout.brand.text, layout.brand.x, layout.brand.y);
  return layout;
}

// サムネイル作成画面のプレビュー: 写真の切り出し範囲だけを正方形に描く(タグ・日付なし)
export function drawCropPreview(canvas, { bitmap, crop }) {
  const size = CARD_SIZE;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  if (!bitmap) return;
  const { sx, sy, sw, sh } = photoSourceRect(bitmap.width, bitmap.height, crop ?? {});
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, size, size);
}

// 切り出し範囲を反映した正方形サムネイル(320px・JPEG)。カードで選んだ範囲を一押しサムネイルにも使う
export const THUMB_SIZE = 320;
export async function cropThumb(photoBlob, crop) {
  const bitmap = await loadBitmap(photoBlob);
  try {
    const { sx, sy, sw, sh } = photoSourceRect(bitmap.width, bitmap.height, crop ?? {});
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, THUMB_SIZE, THUMB_SIZE);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('サムネイルを作れませんでした。'))), 'image/jpeg', 0.85);
    });
  } finally {
    bitmap?.close?.();
  }
}

// 設定画面のプレビュー(v1.05): タグ1つぶんのスタンプを中央に描く(背景はパネル色)
export const STAMP_PREVIEW_W = 480;
export const STAMP_PREVIEW_H = 200;
export function drawStampPreview(canvas, { text, stamp = null, theme, bitmap = null, panel = '#ffffff' }) {
  canvas.width = STAMP_PREVIEW_W;
  canvas.height = STAMP_PREVIEW_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, STAMP_PREVIEW_W, STAMP_PREVIEW_H);
  const base = stamp?.type === 'image' && bitmap ? imageStampSize(bitmap.width, bitmap.height) : stampSize(text, 'h');
  const scale = Math.min(1, (STAMP_PREVIEW_W - 60) / base.w, (STAMP_PREVIEW_H - 60) / base.h);
  const accent = theme?.accent ?? '#4a7dbd';
  const colors = { chipBg: 'rgba(255,255,255,0.96)', chipText: accent, stampInk: accent };
  drawStamp(ctx, { cx: STAMP_PREVIEW_W / 2, cy: STAMP_PREVIEW_H / 2, w: base.w, h: base.h, rotate: -4 }, text, colors, { scale, stamp, bitmap });
}

// { dateKey, tagNames, photoBlob|null, crop, theme, stickers, stampBitmaps } → PNG Blob
export async function renderCard({ dateKey, tagNames, photoBlob = null, crop, theme, stickers = null, stampBitmaps = null }) {
  const bitmap = photoBlob ? await loadBitmap(photoBlob) : null;
  const canvas = document.createElement('canvas');
  try {
    drawCard(canvas, { dateKey, tagNames, bitmap, crop, theme, stickers, stampBitmaps });
  } finally {
    bitmap?.close?.();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('カードの画像を作れませんでした。'))), 'image/png');
  });
}
