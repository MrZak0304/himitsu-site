// 「きょうの1枚カード」の canvas 描画(v1.1 U2)。レイアウトは core/card.js(ピュア)で計算し、
// ここは描くだけ。フォントはシステムフォント(不変条件7: 外部フォントを使わない)。
// 生成は端末内で完結し、共有は backup-io.js の deliverFile(OS の共有シート)で行う。
// プレビュー(card-dialog.js)と本番出力(PNG)で同じ drawCard を使う=見たままが出る。

import { layoutCard, photoSourceRect } from './core/card.js';

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

// ハンコ風のタグ(二重枠・少し傾ける・インクはテーマ色)
function drawStamp(ctx, chip, colors) {
  const cx = chip.x + chip.w / 2;
  const cy = chip.y + chip.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((chip.rotate ?? 0) * Math.PI) / 180);
  const x = -chip.w / 2;
  const y = -chip.h / 2;
  const r = 18;
  ctx.fillStyle = colors.chipBg;
  roundRect(ctx, x, y, chip.w, chip.h, r);
  ctx.fill();
  // 外枠(太)+内枠(細)の二重線でハンコらしさを出す
  ctx.strokeStyle = colors.stampInk;
  ctx.lineWidth = 6;
  roundRect(ctx, x, y, chip.w, chip.h, r);
  ctx.stroke();
  ctx.lineWidth = 2;
  roundRect(ctx, x + 9, y + 9, chip.w - 18, chip.h - 18, r - 8);
  ctx.stroke();
  ctx.fillStyle = colors.chipText;
  ctx.font = font(chip.fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(chip.text, 0, 2, chip.w - 36);
  ctx.restore();
}

// canvas にカードを描く。bitmap は loadBitmap 済みの写真(null なら写真なし)。
// crop は {cx, cy, zoom}(core/card.js の photoSourceRect)。
export function drawCard(canvas, { dateKey, tagNames, bitmap = null, crop, theme }) {
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

  // タグ(ハンコ風)
  for (const row of layout.tagRows) {
    for (const chip of row.chips) drawStamp(ctx, chip, layout.colors);
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

// { dateKey, tagNames, photoBlob|null, crop, theme } → PNG Blob
export async function renderCard({ dateKey, tagNames, photoBlob = null, crop, theme }) {
  const bitmap = photoBlob ? await loadBitmap(photoBlob) : null;
  const canvas = document.createElement('canvas');
  try {
    drawCard(canvas, { dateKey, tagNames, bitmap, crop, theme });
  } finally {
    bitmap?.close?.();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('カードの画像を作れませんでした。'))), 'image/png');
  });
}
