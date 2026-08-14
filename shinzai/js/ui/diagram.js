// js/ui/diagram.js — 骨格図SVGの生成(三面図: 正面・側面・背面)
// 参考画像のスケッチと同様に寸法を注記する。注記は面ごとに分担して詰め込みすぎない:
//   正面=頭〜腰・腰〜足先・腕 / 側面=全高・足の長さ / 背面=肩幅・もも・すね
// デザイン画像・外部フォントは使わない(インラインSVGのみ)。

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function dimLineV(x, y1, y2, label, anchor = 'start') {
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

function dimLineH(y, x1, x2, label) {
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

const VIEW_W = 340;
const VIEW_H = 460;

// 完成サイズcm → 描画pxの共通ジオメトリ
function geometry(seg) {
  const H = seg.figureHeight;
  const pad = 36;
  const k = (VIEW_H - pad * 2) / H;
  const cx = VIEW_W / 2 - 30;
  const y = (cm) => pad + cm * k;
  return {
    k, cx, y,
    headR: (seg.head / 2) * k,
    neckY: y(seg.head),
    shoulderY: y(seg.head * 1.15),
    hipY: y(seg.headTopToHip),
    soleY: y(H),
    top: pad,
    shoulderHalf: (seg.shoulderWidth / 2) * k,
    hipHalf: (seg.shoulderWidth / 2) * k * 0.7,
  };
}

// 正面・背面共通の骨組み(左右対称)
function frontBones(seg, g) {
  const bones = el('g', { class: 'bones' });
  bones.append(
    el('circle', { cx: g.cx, cy: g.top + g.headR, r: g.headR, fill: 'none' }),
    el('line', { x1: g.cx, y1: g.neckY, x2: g.cx, y2: g.hipY }),
    el('line', { x1: g.cx - g.shoulderHalf, y1: g.shoulderY, x2: g.cx + g.shoulderHalf, y2: g.shoulderY }),
    el('line', { x1: g.cx - g.hipHalf, y1: g.hipY, x2: g.cx + g.hipHalf, y2: g.hipY }),
  );
  for (const side of [-1, 1]) {
    const sx = g.cx + side * g.shoulderHalf;
    const ex = sx + side * 6;
    const elbowY = g.shoulderY + seg.upperArm * g.k;
    const wx = ex + side * 4;
    const wristY = elbowY + seg.forearm * g.k;
    bones.append(
      el('line', { x1: sx, y1: g.shoulderY, x2: ex, y2: elbowY }),
      el('line', { x1: ex, y1: elbowY, x2: wx, y2: wristY }),
      el('ellipse', {
        cx: wx + side * (seg.hand / 2) * g.k * 0.4,
        cy: wristY + (seg.hand / 2) * g.k,
        rx: Math.max(3, (seg.hand / 3) * g.k),
        ry: (seg.hand / 2) * g.k,
        fill: 'none',
      }),
    );
    const hx = g.cx + side * g.hipHalf;
    const kneeY = g.hipY + seg.thigh * g.k;
    const ankleY = kneeY + seg.shin * g.k;
    bones.append(
      el('line', { x1: hx, y1: g.hipY, x2: hx, y2: kneeY }),
      el('line', { x1: hx, y1: kneeY, x2: hx, y2: ankleY }),
      el('ellipse', {
        cx: hx + side * (seg.footLength / 2) * g.k * 0.6,
        cy: g.soleY - (seg.ankle / 2) * g.k,
        rx: (seg.footLength / 2) * g.k,
        ry: Math.max(2, (seg.ankle / 2) * g.k),
        fill: 'none',
      }),
    );
  }
  return bones;
}

// 側面(右向き)の骨組み。腕・脚は左右が重なる想定で1本ずつ描く
function sideBones(seg, g) {
  const bones = el('g', { class: 'bones' });
  const footPx = seg.footLength * g.k;
  bones.append(
    el('circle', { cx: g.cx + g.headR * 0.25, cy: g.top + g.headR, r: g.headR, fill: 'none' }),
    el('line', { x1: g.cx, y1: g.neckY, x2: g.cx, y2: g.hipY }),
  );
  const elbowY = g.shoulderY + seg.upperArm * g.k;
  const wristY = elbowY + seg.forearm * g.k;
  bones.append(
    el('line', { x1: g.cx, y1: g.shoulderY, x2: g.cx - 5, y2: elbowY }),
    el('line', { x1: g.cx - 5, y1: elbowY, x2: g.cx - 2, y2: wristY }),
    el('ellipse', {
      cx: g.cx - 2, cy: wristY + (seg.hand / 2) * g.k,
      rx: Math.max(3, (seg.hand / 3) * g.k), ry: (seg.hand / 2) * g.k, fill: 'none',
    }),
  );
  const kneeY = g.hipY + seg.thigh * g.k;
  const ankleY = kneeY + seg.shin * g.k;
  bones.append(
    el('line', { x1: g.cx, y1: g.hipY, x2: g.cx + 3, y2: kneeY }),
    el('line', { x1: g.cx + 3, y1: kneeY, x2: g.cx, y2: ankleY }),
    // 足: かかと〜つま先(進行方向=右)
    el('line', { x1: g.cx - footPx * 0.3, y1: g.soleY, x2: g.cx + footPx * 0.7, y2: g.soleY }),
    el('line', { x1: g.cx, y1: ankleY, x2: g.cx, y2: g.soleY }),
  );
  return bones;
}

// 肉付けイメージ(人型シルエット)。骨格の下に敷く(2026-08-14 PDフィードバック第3弾、
// 第4弾「人型から離れすぎ」を受けて曲線+太さのテーパーで人体らしく)。
// 太さは肩幅基準(頭身をいじっても破綻しない)。

function fleshWidths(g) {
  return {
    armW: Math.max(4, g.shoulderHalf * 0.5), // 上腕
    foreW: Math.max(3, g.shoulderHalf * 0.38), // 前腕
    legW: Math.max(5, g.shoulderHalf * 0.8), // もも
    shinW: Math.max(4, g.shoulderHalf * 0.55), // すね
    neckW: Math.max(3, g.shoulderHalf * 0.4),
  };
}

function fleshFront(seg, g) {
  const flesh = el('g', { class: 'flesh' });
  const { armW, foreW, legW, shinW, neckW } = fleshWidths(g);
  const torsoH = g.hipY - g.shoulderY;
  // 頭(やや縦長の楕円)+首
  flesh.append(
    el('ellipse', { cx: g.cx, cy: g.top + g.headR, rx: g.headR * 0.86, ry: g.headR * 1.02 }),
    el('line', { x1: g.cx, y1: g.neckY - 2, x2: g.cx, y2: g.shoulderY + 4, 'stroke-width': neckW }),
  );
  // 胴: 肩→(くびれ)ウエスト→腰→パンツラインの左右対称カーブ
  const sw = g.shoulderHalf * 0.94;
  const hw = Math.max(g.hipHalf * 1.35, sw * 0.75);
  const waistY = g.shoulderY + torsoH * 0.58;
  const ww = Math.min(sw, hw) * 0.78;
  const crotchY = g.hipY + legW * 0.55;
  // 左側は肩→腰へ下り、右側は腰→肩へ上る(制御点は左の鏡映を逆順に)
  flesh.append(el('path', {
    d: `M ${g.cx - sw} ${g.shoulderY}`
      + ` C ${g.cx - sw * 1.02} ${g.shoulderY + torsoH * 0.3} ${g.cx - ww * 1.05} ${waistY - torsoH * 0.08} ${g.cx - ww} ${waistY}`
      + ` C ${g.cx - ww * 0.98} ${waistY + torsoH * 0.12} ${g.cx - hw} ${g.hipY - torsoH * 0.12} ${g.cx - hw} ${g.hipY}`
      + ` Q ${g.cx - hw * 0.5} ${crotchY + legW * 0.35} ${g.cx} ${crotchY}`
      + ` Q ${g.cx + hw * 0.5} ${crotchY + legW * 0.35} ${g.cx + hw} ${g.hipY}`
      + ` C ${g.cx + hw} ${g.hipY - torsoH * 0.12} ${g.cx + ww * 0.98} ${waistY + torsoH * 0.12} ${g.cx + ww} ${waistY}`
      + ` C ${g.cx + ww * 1.05} ${waistY - torsoH * 0.08} ${g.cx + sw * 1.02} ${g.shoulderY + torsoH * 0.3} ${g.cx + sw} ${g.shoulderY}`
      + ' Z',
  }));
  // 肩の丸み
  for (const side of [-1, 1]) {
    flesh.append(el('circle', {
      cx: g.cx + side * sw * 0.9, cy: g.shoulderY + armW * 0.35, r: armW * 0.6,
    }));
  }
  for (const side of [-1, 1]) {
    const sx = g.cx + side * g.shoulderHalf;
    const ex = sx + side * 6;
    const elbowY = g.shoulderY + seg.upperArm * g.k;
    const wx = ex + side * 4;
    const wristY = elbowY + seg.forearm * g.k;
    // 腕: 上腕(太)→前腕(細)のテーパー+手
    flesh.append(
      el('line', { x1: sx, y1: g.shoulderY, x2: ex, y2: elbowY, 'stroke-width': armW }),
      el('line', { x1: ex, y1: elbowY, x2: wx, y2: wristY, 'stroke-width': foreW }),
      el('ellipse', {
        cx: wx + side * (seg.hand / 2) * g.k * 0.4,
        cy: wristY + (seg.hand / 2) * g.k,
        rx: Math.max(3, (seg.hand / 3.2) * g.k),
        ry: (seg.hand / 2) * g.k,
      }),
    );
    // 脚: もも(太)→すね(細)のテーパー+足
    const hx = g.cx + side * g.hipHalf;
    const kneeY = g.hipY + seg.thigh * g.k;
    const ankleY = kneeY + seg.shin * g.k;
    flesh.append(
      el('line', { x1: hx, y1: g.hipY, x2: hx, y2: kneeY, 'stroke-width': legW }),
      el('line', { x1: hx, y1: kneeY, x2: hx, y2: ankleY, 'stroke-width': shinW }),
      el('ellipse', {
        cx: hx + side * (seg.footLength / 2) * g.k * 0.6,
        cy: g.soleY - (seg.ankle / 2) * g.k,
        rx: (seg.footLength / 2) * g.k * 1.05,
        ry: Math.max(3, (seg.ankle / 2) * g.k * 1.15),
      }),
    );
  }
  return flesh;
}

function fleshSide(seg, g) {
  const flesh = el('g', { class: 'flesh' });
  const { armW, foreW, legW, shinW } = fleshWidths(g);
  const bodyW = Math.max(6, g.shoulderHalf * 0.95); // 側面の胴の厚み
  const elbowY = g.shoulderY + seg.upperArm * g.k;
  const wristY = elbowY + seg.forearm * g.k;
  const kneeY = g.hipY + seg.thigh * g.k;
  const ankleY = kneeY + seg.shin * g.k;
  const footPx = seg.footLength * g.k;
  const waistY = (g.shoulderY + g.hipY) / 2;
  flesh.append(
    el('ellipse', {
      cx: g.cx + g.headR * 0.25, cy: g.top + g.headR, rx: g.headR * 0.95, ry: g.headR * 1.02,
    }),
    // 胴: 胸を前、腰を後ろに引いたゆるいS字
    el('path', {
      d: `M ${g.cx} ${g.neckY - 2}`
        + ` C ${g.cx + bodyW * 0.25} ${g.shoulderY + (waistY - g.shoulderY) * 0.6} ${g.cx - bodyW * 0.2} ${waistY} ${g.cx} ${g.hipY}`,
      fill: 'none', 'stroke-width': bodyW,
    }),
    el('line', { x1: g.cx, y1: g.shoulderY, x2: g.cx - 5, y2: elbowY, 'stroke-width': armW }),
    el('line', { x1: g.cx - 5, y1: elbowY, x2: g.cx - 2, y2: wristY, 'stroke-width': foreW }),
    el('ellipse', {
      cx: g.cx - 2, cy: wristY + (seg.hand / 2) * g.k,
      rx: Math.max(3, (seg.hand / 3.2) * g.k), ry: (seg.hand / 2) * g.k,
    }),
    el('line', { x1: g.cx, y1: g.hipY, x2: g.cx + 3, y2: kneeY, 'stroke-width': legW }),
    el('line', { x1: g.cx + 3, y1: kneeY, x2: g.cx, y2: ankleY, 'stroke-width': shinW }),
    el('path', {
      d: `M ${g.cx - footPx * 0.3} ${g.soleY - 2} L ${g.cx + footPx * 0.7} ${g.soleY - 2}`,
      fill: 'none', 'stroke-width': Math.max(4, seg.ankle * g.k),
    }),
  );
  return flesh;
}

// result = computeArmature() の戻り値、view = 'front' | 'side' | 'back'
// opts.flesh = true で肉付けイメージ(シルエット)を骨格の下に重ねる
export function renderDiagram(result, view = 'front', { flesh = false } = {}) {
  const seg = result.segments;
  const g = geometry(seg);
  const svg = el('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    role: 'img',
    'aria-label': `骨格図(${view === 'front' ? '正面' : view === 'side' ? '側面' : '背面'})`,
  });
  if (view === 'side') {
    if (flesh) svg.append(fleshSide(seg, g));
    svg.append(sideBones(seg, g));
    svg.append(
      dimLineV(g.cx + g.headR + 50, g.top, g.soleY, `全高 ${seg.figureHeight}cm`),
      dimLineH(g.soleY + 24, g.cx - seg.footLength * g.k * 0.3, g.cx + seg.footLength * g.k * 0.7,
        `足 ${seg.footLength}cm`),
    );
  } else {
    if (flesh) svg.append(fleshFront(seg, g));
    svg.append(frontBones(seg, g));
    if (view === 'front') {
      const rightX = g.cx + Math.max(g.shoulderHalf, g.hipHalf) + 52;
      svg.append(
        dimLineV(rightX, g.top, g.hipY, `頭〜腰 ${seg.headTopToHip}cm`),
        dimLineV(rightX, g.hipY, g.soleY, `腰〜足先 ${seg.hipToSole}cm`),
        dimLineV(g.cx - g.shoulderHalf - 36, g.shoulderY, g.shoulderY + seg.armTotal * g.k,
          `腕 ${seg.armTotal}cm`, 'end'),
      );
    } else {
      const kneeY = g.hipY + seg.thigh * g.k;
      const ankleY = kneeY + seg.shin * g.k;
      svg.append(
        dimLineH(g.top - 14, g.cx - g.shoulderHalf, g.cx + g.shoulderHalf,
          `肩幅 ${seg.shoulderWidth}cm`),
        dimLineV(g.cx + g.hipHalf + 40, g.hipY, kneeY, `もも ${seg.thigh}cm`),
        dimLineV(g.cx + g.hipHalf + 40, kneeY, ankleY, `すね ${seg.shin}cm`),
      );
    }
  }
  return svg;
}

// 三面図(正面・側面・背面)をまとめて返す
export function renderThreeViews(result, opts = {}) {
  const frag = document.createDocumentFragment();
  const views = [['front', '正面'], ['side', '側面'], ['back', '背面']];
  for (const [view, label] of views) {
    const fig = document.createElement('figure');
    fig.className = 'view';
    fig.append(renderDiagram(result, view, opts));
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    fig.append(cap);
    frag.append(fig);
  }
  return frag;
}
