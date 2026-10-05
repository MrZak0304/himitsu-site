// 「きょうの1枚カード」の canvas 描画(v1.1 U2)。レイアウトは core/card.js(ピュア)で計算し、
// ここは描くだけ。フォントはシステムフォント(不変条件7: 外部フォントを使わない)。
// 生成は端末内で完結し、共有は backup-io.js の deliverFile(OS の共有シート)で行う。

import { layoutCard } from './core/card.js';

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

async function loadBitmap(blob) {
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

// { dateKey, tagNames, photoBlob|null, theme } → PNG Blob
export async function renderCard({ dateKey, tagNames, photoBlob = null, theme }) {
  const layout = layoutCard({ dateKey, tagNames, hasPhoto: !!photoBlob, theme });
  const { size } = layout;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 背景
  if (layout.background.kind === 'photo') {
    const bmp = await loadBitmap(photoBlob);
    const bw = bmp.width;
    const bh = bmp.height;
    const scale = Math.max(size / bw, size / bh); // cover
    const dw = bw * scale;
    const dh = bh * scale;
    ctx.drawImage(bmp, (size - dw) / 2, (size - dh) / 2, dw, dh);
    bmp.close?.();
  } else {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, layout.background.from);
    g.addColorStop(1, layout.background.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // 下部の膜(文字の可読性)
  const sg = ctx.createLinearGradient(0, layout.scrim.y, 0, size);
  const sc = layout.colors.scrim;
  sg.addColorStop(0, `${sc}00`);
  sg.addColorStop(0.25, `${sc}${Math.round(layout.scrim.alpha * 0.35 * 255).toString(16).padStart(2, '0')}`);
  sg.addColorStop(0.55, `${sc}${Math.round(layout.scrim.alpha * 255).toString(16).padStart(2, '0')}`);
  sg.addColorStop(1, `${sc}${Math.round(Math.min(1, layout.scrim.alpha + 0.2) * 255).toString(16).padStart(2, '0')}`);
  ctx.fillStyle = sg;
  ctx.fillRect(0, layout.scrim.y, size, layout.scrim.h);

  // タグチップ
  ctx.textBaseline = 'middle';
  for (const row of layout.tagRows) {
    for (const chip of row.chips) {
      ctx.fillStyle = layout.colors.chipBg;
      roundRect(ctx, chip.x, chip.y, chip.w, chip.h, chip.h / 2);
      ctx.fill();
      ctx.fillStyle = layout.colors.chipText;
      ctx.font = font(chip.fontSize);
      ctx.textAlign = 'center';
      // 見積もり幅より実測が広い場合はチップ内に収める
      const maxW = chip.w - 24;
      ctx.fillText(chip.text, chip.x + chip.w / 2, chip.y + chip.h / 2 + 2, maxW);
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

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('カードの画像を作れませんでした。'))), 'image/png');
  });
}
