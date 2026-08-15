// js/ui/diagram.js — 三面図の寸法注記ヘルパー+共通ジオメトリ(cm→px)
// 注記は面ごとに分担して詰め込みすぎない: 正面=肩幅・頭〜腰・腰〜足先・腕 / 左側面=全高 / 右側面=足・もも・すね
// デザイン画像・外部フォントは使わない(インラインSVGのみ)。

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

export function dimLineV(x, y1, y2, label, anchor = 'start') {
  const g = el('g', { class: 'dim' });
  g.append(
    el('line', { x1: x, y1, x2: x, y2 }),
    el('line', { x1: x - 5, y1, x2: x + 5, y2: y1 }),
    el('line', { x1: x - 5, y1: y2, x2: x + 5, y2 }),
  );
  const text = el('text', {
    x: anchor === 'start' ? x + 8 : x - 8,
    y: (y1 + y2) / 2,
    'dominant-baseline': 'middle',
    'text-anchor': anchor,
  });
  text.textContent = label;
  g.append(text);
  return g;
}

export function dimLineH(y, x1, x2, label) {
  const g = el('g', { class: 'dim' });
  g.append(
    el('line', { x1, y1: y, x2, y2: y }),
    el('line', { x1, y1: y - 5, x2: x1, y2: y + 5 }),
    el('line', { x1: x2, y1: y - 5, x2, y2: y + 5 }),
  );
  const text = el('text', {
    x: (x1 + x2) / 2, y: y - 8, 'text-anchor': 'middle',
  });
  text.textContent = label;
  g.append(text);
  return g;
}

export const VIEW_W = 340;
export const VIEW_H = 460;

// 完成サイズcm → 描画pxの共通ジオメトリ
export function geometry(seg) {
  const H = seg.figureHeight;
  const pad = 36;
  const k = (VIEW_H - pad * 2) / H;
  const cx = VIEW_W / 2 - 30;
  const y = (cm) => pad + cm * k;
  return {
    k, cx, y,
    headR: (seg.head / 2) * k,
    neckY: y(seg.head),
    shoulderY: y(seg.head * 1.35), // 首の長さ=頭高の0.35(pose3d の restPose と揃える)
    hipY: y(seg.headTopToHip),
    soleY: y(H),
    top: pad,
    shoulderHalf: (seg.shoulderWidth / 2) * k,
    hipHalf: (seg.shoulderWidth / 2) * k * 0.7,
  };
}

// 旧: 固定ジオメトリの骨格/シルエット描画は js/ui/posefig.js(関節駆動の統一レンダラー)に
// 統合した(2026-08-15 PDフィードバック第12弾「ポーズON/OFFで肉付けの見た目を変えない」)。
// このファイルは寸法注記のヘルパーと共通ジオメトリのみを提供する。
