// js/core/imagefit.js — 取り込み画像から人物(前景)のおおまかな位置を検出する
// 完全なポーズ推定(v2検討)ではなく、テンプレート骨格の初期配置を画像内の人物に
// 合わせるための軽量解析(2026-08-14 PDフィードバック「一から移動するのは大変」対応)。
// ImageData互換 {width, height, data} を受け取るピュアロジック。canvas操作はUI側で行う。

// 行ごとの前景の広がり(幅・中心)を求める。背景=四隅の色(いずれかに近い色)または透明。
export function rowProfile(imageData, { threshold = 48, minRun = 2 } = {}) {
  const { width: w, height: h, data } = imageData;
  if (!w || !h || !data || data.length < w * h * 4) return null;
  const px = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const isForeground = (x, y) => {
    const [r, g, b, a] = px(x, y);
    if (a < 16) return false; // 透明=背景
    for (const [cr, cg, cb, ca] of corners) {
      if (ca < 16) continue;
      const d = Math.max(Math.abs(r - cr), Math.abs(g - cg), Math.abs(b - cb));
      if (d <= threshold) return false; // 四隅のどれかに近い色=背景
    }
    return true;
  };
  const rows = [];
  for (let y = 0; y < h; y++) {
    let count = 0; let minX = -1; let maxX = -1;
    for (let x = 0; x < w; x++) {
      if (isForeground(x, y)) {
        count++;
        if (minX < 0) minX = x;
        maxX = x;
      }
    }
    rows.push(count >= minRun ? { y, count, minX, maxX, width: maxX - minX + 1, mid: (minX + maxX) / 2 } : null);
  }
  return { w, h, rows };
}

export function detectFigureBox(imageData, opts = {}) {
  const prof = rowProfile(imageData, opts);
  if (!prof) return { found: false };
  const { h, rows } = prof;
  let top = -1; let bottom = -1; let centerSum = 0; let centerWeight = 0;
  for (const r of rows) {
    if (!r) continue;
    if (top < 0) top = r.y;
    bottom = r.y;
    centerSum += r.mid * r.count;
    centerWeight += r.count;
  }
  if (top < 0 || bottom - top < h * 0.15) {
    return { found: false }; // 人物らしい高さの前景が見つからない
  }
  return { found: true, top, bottom, centerX: centerSum / centerWeight };
}

// 頭(頭頂〜首)のおおまかな範囲。立ち絵で「顔の大きさを骨格に合わせる」ための推定(第67弾FB)。
// 上から見て幅がいちばん広がったところ(頭)のあと、幅が細くなる行(首)を頭の下端とみなす。
export function detectHead(imageData, opts = {}) {
  const box = detectFigureBox(imageData, opts);
  if (!box.found) return { found: false };
  const prof = rowProfile(imageData, opts);
  const rows = prof.rows.filter(Boolean);
  const bodyH = box.bottom - box.top;
  const limit = box.top + bodyH * 0.45; // 首は上から45%以内にあるはず
  // 頭のいちばん広い行 = 上から見て最初に幅が増えきったところ(肩は頭より広いので、
  // 全行の最大値を取ると肩を拾ってしまう。第67弾FB)
  let widest = 0; let widestY = box.top; let headCenter = null;
  for (const r of rows) {
    if (r.y > limit) break;
    if (r.width >= widest) { widest = r.width; widestY = r.y; headCenter = r.mid; continue; }
    if (r.width < widest * 0.9) break; // 減り始めた=頭の最大幅を過ぎた
  }
  if (!(widest > 0)) return { found: false };
  let neckY = -1;
  for (const r of rows) {
    if (r.y <= widestY) continue;
    if (r.y > limit) break;
    if (r.width <= widest * 0.68) { neckY = r.y; break; } // 幅が3割以上細くなった=首
    if (r.width > widest * 1.05) break; // 細くならないまま広がった=頭を判定できない
  }
  if (neckY < 0 || neckY - box.top < bodyH * 0.05) return { found: false };
  return { found: true, top: box.top, neckY, centerX: headCenter, box };
}
