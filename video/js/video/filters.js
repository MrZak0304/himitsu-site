// フィルター描画(Canvas 依存)。モザイク/ぼかしを楕円領域にかける。
// フィルターは「見た目を隠す」ためだけの処理で、復元はフィルターの逆変換ではなく
// 復元データの合成で行う(SPEC §2 合成方式)。

/** 楕円のパスを ctx に設定する */
export function regionPath(ctx, g) {
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, Math.max(1, g.rx), Math.max(1, g.ry), 0, 0, Math.PI * 2);
}

/**
 * ctx(すでに元フレームが描かれている)へ、各領域にフィルターをかける。
 * geoms: {cx,cy,rx,ry} の配列(null は除外済みであること)
 * filter: { type: 'mosaic'|'blur', size } — mosaic はタイル粗さ px、blur は強さ px
 * source: 元フレームが描かれた canvas(モザイクはここからピクセルを読む)
 */
export function applyFilters(ctx, source, geoms, filter) {
  for (const g of geoms) {
    if (filter.type === 'mosaic') {
      mosaicRegion(ctx, source, g, filter.size);
    } else {
      blurRegion(ctx, source, g, filter.size);
    }
  }
}

// タイルの平均色を getImageData から直接計算する。
// drawImage の大縮小は GPU パスでは点サンプリングになり「平均」にならないため、
// 縮小描画によるモザイクは禁止(docs/lessons/2026-08-05-mosaic-downscale.md)。
function mosaicRegion(ctx, source, g, blockSize) {
  const x = Math.max(0, Math.floor(g.cx - g.rx));
  const y = Math.max(0, Math.floor(g.cy - g.ry));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(g.rx * 2));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(g.ry * 2));
  if (w <= 0 || h <= 0) return;
  const img = source.getContext('2d').getImageData(x, y, w, h);
  const data = img.data;
  ctx.save();
  regionPath(ctx, g);
  ctx.clip();
  for (let ty = 0; ty < h; ty += blockSize) {
    const bh = Math.min(blockSize, h - ty);
    for (let tx = 0; tx < w; tx += blockSize) {
      const bw = Math.min(blockSize, w - tx);
      let r = 0, gr = 0, b = 0;
      for (let yy = ty; yy < ty + bh; yy++) {
        let o = (yy * w + tx) * 4;
        for (let xx = 0; xx < bw; xx++, o += 4) {
          r += data[o];
          gr += data[o + 1];
          b += data[o + 2];
        }
      }
      const n = bw * bh;
      ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})`;
      ctx.fillRect(x + tx, y + ty, bw, bh);
    }
  }
  ctx.restore();
}

function blurRegion(ctx, source, g, strength) {
  ctx.save();
  regionPath(ctx, g);
  ctx.clip();
  ctx.filter = `blur(${strength}px)`;
  // クリップ境界のにじみ残りを避けるため少し広めに描く
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  ctx.restore();
}

/**
 * 復元合成: ctx(共有動画のフレームが描かれている)へ、復元フレームの
 * スロット領域を領域形状でクリップして重ねる。pad は境界のにじみ対策。
 */
export function composeRestore(ctx, restoreSource, track, g, pad = 2) {
  const { crop, slotY } = track;
  ctx.save();
  regionPath(ctx, { cx: g.cx, cy: g.cy, rx: g.rx + pad, ry: g.ry + pad });
  ctx.clip();
  ctx.drawImage(restoreSource, 0, slotY, crop.w, crop.h, crop.x, crop.y, crop.w, crop.h);
  ctx.restore();
}
