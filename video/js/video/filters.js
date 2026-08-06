// フィルター描画(Canvas 依存)。モザイク/ぼかしを楕円領域にかける。
// フィルターは「見た目を隠す」ためだけの処理で、復元はフィルターの逆変換ではなく
// 復元データの合成で行う(SPEC §2 合成方式)。

/** 領域のパスを ctx に設定する(g.shape: 'rect' は矩形、それ以外は楕円) */
export function regionPath(ctx, g) {
  ctx.beginPath();
  if (g.shape === 'rect') {
    ctx.rect(g.cx - g.rx, g.cy - g.ry, Math.max(2, g.rx * 2), Math.max(2, g.ry * 2));
  } else {
    ctx.ellipse(g.cx, g.cy, Math.max(1, g.rx), Math.max(1, g.ry), 0, 0, Math.PI * 2);
  }
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

// ぼかしはハイブリッド実装(docs/lessons/2026-08-06-safari-ctx-filter.md):
//  - ctx.filter('blur(...)') 対応ブラウザ(Chrome等)はネイティブのガウスぼかし
//  - 非対応(Safari iOS18未満等)は「2倍ずつの縮小→2倍ずつの拡大」で近似。
//    1ステップ2倍の縮小は GPU パスでも正確な 2×2 平均になるため、
//    大縮小の点サンプリング問題(不変条件9)は起きない。
let nativeBlurSupported = null;

/** テスト用: ネイティブぼかし判定を強制上書きする(null で再判定) */
export function setNativeBlurOverride(value) {
  nativeBlurSupported = value;
}

function supportsCtxFilter(ctx) {
  if (nativeBlurSupported === null) {
    try {
      ctx.save();
      ctx.filter = 'blur(2px)';
      nativeBlurSupported = ctx.filter !== 'none';
      ctx.restore();
    } catch {
      nativeBlurSupported = false;
    }
  }
  return nativeBlurSupported;
}

function blurRegion(ctx, source, g, strength) {
  if (supportsCtxFilter(ctx)) {
    ctx.save();
    regionPath(ctx, g);
    ctx.clip();
    ctx.filter = `blur(${strength}px)`;
    ctx.drawImage(source, 0, 0);
    ctx.filter = 'none';
    ctx.restore();
    return;
  }

  // フォールバック: 段階縮小→段階拡大
  const margin = Math.ceil(strength);
  const x = Math.max(0, Math.floor(g.cx - g.rx - margin));
  const y = Math.max(0, Math.floor(g.cy - g.ry - margin));
  const w = Math.min(ctx.canvas.width - x, Math.ceil((g.rx + margin) * 2));
  const h = Math.min(ctx.canvas.height - y, Math.ceil((g.ry + margin) * 2));
  if (w <= 0 || h <= 0) return;

  // ぼかし強さ(px)→ 半減ステップ数(4px→2回、12px→4回、40px→5回)
  const steps = Math.max(1, Math.min(5, Math.round(Math.log2(strength)) + 1));
  let cur = makeScratchCanvas(Math.max(1, w >> 1), Math.max(1, h >> 1));
  cur.getContext('2d').drawImage(source, x, y, w, h, 0, 0, cur.width, cur.height);
  for (let i = 1; i < steps && (cur.width > 2 || cur.height > 2); i++) {
    cur = halveOrDouble(cur, Math.max(1, cur.width >> 1), Math.max(1, cur.height >> 1));
  }
  // 拡大も2倍ずつ行うと補間が滑らかになる
  while (cur.width < w || cur.height < h) {
    cur = halveOrDouble(cur, Math.min(w, cur.width * 2), Math.min(h, cur.height * 2));
  }

  ctx.save();
  regionPath(ctx, g);
  ctx.clip();
  ctx.drawImage(cur, 0, 0, cur.width, cur.height, x, y, w, h);
  ctx.restore();
}

function halveOrDouble(src, nw, nh) {
  const next = makeScratchCanvas(nw, nh);
  const nctx = next.getContext('2d');
  nctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in nctx) nctx.imageSmoothingQuality = 'high';
  nctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, nw, nh);
  return next;
}

function makeScratchCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * 復元合成: ctx(共有動画のフレームが描かれている)へ、復元フレームの
 * スロット領域を領域形状でクリップして重ねる。pad は境界のにじみ対策。
 */
export function composeRestore(ctx, restoreSource, track, g, pad = 2) {
  const { crop, slotY } = track;
  ctx.save();
  regionPath(ctx, { cx: g.cx, cy: g.cy, rx: g.rx + pad, ry: g.ry + pad, shape: track.shape });
  ctx.clip();
  ctx.drawImage(restoreSource, 0, slotY, crop.w, crop.h, crop.x, crop.y, crop.w, crop.h);
  ctx.restore();
}
