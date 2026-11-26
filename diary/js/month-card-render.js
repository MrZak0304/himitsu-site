// 「月の1枚」の canvas 描画。レイアウトは core/month-card.js(ピュア)で計算し、ここは描くだけ。
// 使う写真は保存済みのカレンダー用サムネイルだけ(原寸は読まない=不変条件5・10)。
// 生成は端末内で完結し、共有は backup-io.js の deliverFile(OS の共有シート)で行う(不変条件1)。
// プレビュー(month-card-dialog.js)と本番出力(PNG)で同じ drawMonthCard を使う=見たままが出る。

import { layoutMonthCard } from './core/month-card.js';
import { font, roundRect } from './card-render.js';
import { tr } from './i18n/index.js';

// 画像を枠いっぱいに(cover)描く
function drawCover(ctx, bitmap, x, y, w, h) {
  const bw = bitmap.width;
  const bh = bitmap.height;
  if (!(bw > 0) || !(bh > 0)) return;
  const scale = Math.max(w / bw, h / bh);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(bitmap, (bw - sw) / 2, (bh - sh) / 2, sw, sh, x, y, w, h);
}

// canvas に月の1枚を描く。bitmaps は Map<imageId, loadBitmap 済みのサムネイル>(無い画像は写真なしのマスになる)
export function drawMonthCard(canvas, { year, month, weeks, tagName, topTags, showPhotos = true, theme, bitmaps = null }) {
  const layout = layoutMonthCard({ year, month, weeks, tagName, topTags, showPhotos, theme });
  const { w, h, colors } = layout;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = layout.background.color;
  ctx.fillRect(0, 0, w, h);

  // 年月
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.text;
  ctx.font = font(layout.title.fontSize);
  ctx.fillText(layout.title.text, layout.title.x, layout.title.y);

  // 曜日
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.dim;
  for (const d of layout.weekdays) {
    ctx.font = font(d.fontSize, 600);
    ctx.fillText(d.text, d.x, d.y);
  }

  // マス
  for (const cell of layout.cells) {
    const bitmap = cell.imageId ? bitmaps?.get(cell.imageId) ?? null : null;
    ctx.save();
    roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 14);
    ctx.clip();
    if (bitmap) {
      drawCover(ctx, bitmap, cell.x, cell.y, cell.w, cell.h);
      ctx.fillStyle = colors.photoScrim;
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    } else if (cell.hasEntry) {
      ctx.globalAlpha = colors.cellFilledAlpha;
      ctx.fillStyle = colors.cellFilled;
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = colors.cellEmpty;
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = bitmap ? colors.photoText : colors.text;
    ctx.font = font(cell.day.fontSize, 600);
    ctx.fillText(cell.day.text, cell.day.x, cell.day.y);
    for (const tag of cell.tags) {
      ctx.globalAlpha = colors.tagBgAlpha;
      ctx.fillStyle = colors.tagBg;
      roundRect(ctx, tag.x, tag.y, tag.w, tag.h, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.tagText;
      ctx.font = font(tag.fontSize, 600);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag.text, tag.x + tag.w / 2, tag.y + tag.h / 2 + 1, tag.w - 6);
    }
    ctx.restore();
  }

  // よく使うタグ(ハンコ風の二重枠)
  if (layout.ranking) {
    const { label, chips } = layout.ranking;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.dim;
    ctx.font = font(label.fontSize, 600);
    ctx.fillText(label.text, label.x, label.y);
    for (const chip of chips) {
      ctx.fillStyle = colors.chipBg;
      roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 16);
      ctx.fill();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 5;
      roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 16);
      ctx.stroke();
      ctx.lineWidth = 2;
      roundRect(ctx, chip.x + 8, chip.y + 8, chip.w - 16, chip.h - 16, 9);
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.font = font(chip.fontSize);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chip.text, chip.x + chip.w / 2, chip.y + chip.h / 2 + 2, chip.w - 24);
    }
  }

  // アプリ名・ハッシュタグ
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.accent;
  ctx.font = font(layout.brand.fontSize, 600);
  ctx.fillText(layout.brand.text, layout.brand.x, layout.brand.y);
  if (layout.hashtag) {
    ctx.textAlign = 'right';
    ctx.font = font(layout.hashtag.fontSize, 600);
    ctx.fillText(layout.hashtag.text, layout.hashtag.x, layout.hashtag.y);
  }
  return layout;
}

// → PNG Blob
export async function renderMonthCard(params) {
  const canvas = document.createElement('canvas');
  drawMonthCard(canvas, params);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(tr('カードの画像を作れませんでした。')))), 'image/png');
  });
}
