// js/core/imagefit.js — 取り込み画像から人物(前景)のおおまかな位置を検出する
// 完全なポーズ推定(v2検討)ではなく、テンプレート骨格の初期配置を画像内の人物に
// 合わせるための軽量解析(2026-08-14 PDフィードバック「一から移動するのは大変」対応)。
// ImageData互換 {width, height, data} を受け取るピュアロジック。canvas操作はUI側で行う。

// 背景=四隅の色(いずれかに近い色)または透明。それ以外を前景とみなす。
export function detectFigureBox(imageData, { threshold = 48, minRun = 2 } = {}) {
  const { width: w, height: h, data } = imageData;
  if (!w || !h || !data || data.length < w * h * 4) {
    return { found: false };
  }
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

  // 行ごとの前景の本数と中心を集計
  let top = -1;
  let bottom = -1;
  let centerSum = 0;
  let centerWeight = 0;
  for (let y = 0; y < h; y++) {
    let count = 0;
    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < w; x++) {
      if (isForeground(x, y)) {
        count++;
        if (minX < 0) minX = x;
        maxX = x;
      }
    }
    if (count >= minRun) {
      if (top < 0) top = y;
      bottom = y;
      const mid = (minX + maxX) / 2;
      centerSum += mid * count;
      centerWeight += count;
    }
  }

  if (top < 0 || bottom - top < h * 0.15) {
    return { found: false }; // 人物らしい高さの前景が見つからない
  }
  return {
    found: true,
    top,
    bottom,
    centerX: centerSum / centerWeight,
  };
}
