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
  let top = -1; let bottom = -1; let centerSum = 0; let centerWeight = 0; let left = Infinity; let right = -Infinity;
  for (const r of rows) {
    if (!r) continue;
    if (top < 0) top = r.y;
    bottom = r.y;
    centerSum += r.mid * r.count;
    centerWeight += r.count;
    left = Math.min(left, r.minX);
    right = Math.max(right, r.maxX);
  }
  if (top < 0 || bottom - top < h * 0.15) {
    return { found: false }; // 人物らしい高さの前景が見つからない
  }
  return { found: true, top, bottom, left, right, centerX: centerSum / centerWeight };
}

// 頭(頭頂〜首)のおおまかな範囲。立ち絵で「顔の大きさを骨格に合わせる」ための推定(第67弾FB)。
// 上から見て幅がいちばん広がったところ(頭)のあと、幅が細くなる行(首)を頭の下端とみなす。
// 頭(頭頂〜首)の推定。認識の基準:
//   参考画像の「背景でない部分(シルエット)の各行の幅」を上から見て、
//   ・頭 = 上のほうで幅がいちばん広い行(髪を含む頭の最大幅)
//   ・肩 = その下でもう一度幅が広がる行
//   ・首 = 頭と肩のあいだで幅がいちばん細い行(くびれ)
//   としている(第69弾FB「顔の認識の基準を教えてほしい/うまくいかない」への対応で、
//   アンテナ・触角・ヘッドホン等の細い突起に惑わされないよう、幅を平滑化し「頭と肩の間のくびれ=首」で判定)。
//   ※シルエットの形だけを見る簡易判定で、顔そのものは見ていない。うまくいかない絵は手動調整に頼る。
export function detectHead(imageData, opts = {}) {
  const box = detectFigureBox(imageData, opts);
  if (!box.found) return { found: false };
  const prof = rowProfile(imageData, opts);
  const rows = prof.rows.filter(Boolean);
  if (rows.length < 4) return { found: false };
  const bodyH = box.bottom - box.top;
  // 行の幅を平滑化(前後2行の移動平均)。細い突起(アンテナ等)の1〜2行スパイクを抑える
  const byY = new Map(rows.map((r) => [r.y, r]));
  const sw = (r) => {
    let sum = 0; let n = 0;
    for (let dy = -2; dy <= 2; dy++) { const q = byY.get(r.y + dy); if (q) { sum += q.width; n++; } }
    return n ? sum / n : r.width;
  };
  const limit = box.top + bodyH * 0.6; // 頭・首はこの範囲にある想定
  const upper = rows.filter((r) => r.y <= limit);
  if (upper.length < 3) return { found: false };
  // 頭 = 上から見て「最初の幅のピーク」。肩は頭より広いことがあるので単純な最大では拾えない。
  // 幅が増えてピークに達し、そこから 18% 以上細くなったら、それまでのピークを頭とする。
  let head = upper[0]; let headW = sw(upper[0]);
  for (const r of upper) {
    const w = sw(r);
    if (w > headW) { headW = w; head = r; }
    else if (w < headW * 0.82 && head.y - box.top > bodyH * 0.03) break; // ピークを過ぎて細くなった=頭の下
  }
  if (!head || headW <= 0) return { found: false };
  // 首 = 頭のすぐ下で幅がいちばん細くなる行(くびれ)。そこから下で幅が広がれば肩=首と確定
  const bandBottom = Math.min(box.bottom, head.y + Math.max(bodyH * 0.35, headW * 2));
  let neck = null; let neckW = Infinity;
  for (const r of rows) {
    if (r.y <= head.y || r.y > bandBottom) continue;
    const w = sw(r);
    if (w < neckW) { neckW = w; neck = r; }
    else if (neck && w > neckW * 1.4) break; // くびれを過ぎて広がった(肩)
  }
  let widensBelow = false;
  if (neck) {
    for (const r of rows) {
      if (r.y <= neck.y || r.y > bandBottom + bodyH * 0.1) continue;
      if (sw(r) > neckW * 1.3) { widensBelow = true; break; }
    }
  }
  // くびれが見つからない/下で広がらないときは、頭幅から標準の頭の高さ(頭幅×1.3)を見積もる
  let neckY = (neck && widensBelow) ? neck.y : head.y + headW * 0.65;
  if (neckY - box.top < bodyH * 0.04) neckY = head.y + headW * 0.65;
  neckY = Math.min(neckY, box.top + bodyH * 0.5);
  // 頭の横幅は「頭の最大幅の行」の左右(髪を含む)。中心もその行から
  return {
    found: true,
    top: box.top,
    neckY,
    centerX: head.mid,
    left: head.minX,
    right: head.maxX,
    box,
  };
}
