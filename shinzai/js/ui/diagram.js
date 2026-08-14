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

// 肉付けイメージ(ざっくり人型シルエット)。骨格の下に敷く(2026-08-14 PDフィードバック第3弾)
function fleshFront(seg, g) {
  const flesh = el('g', { class: 'flesh' });
  const armW = Math.max(4, g.headR * 0.55);
  const legW = Math.max(5, g.headR * 0.85);
  // 頭・首
  flesh.append(
    el('circle', { cx: g.cx, cy: g.top + g.headR, r: g.headR * 1.04 }),
    el('line', { x1: g.cx, y1: g.neckY - 2, x2: g.cx, y2: g.shoulderY, 'stroke-width': g.headR * 0.55 }),
  );
  // 胴(肩→ウエスト→腰のくびれ付きシルエット)
  const sw = g.shoulderHalf * 0.95;
  const hw = g.hipHalf * 1.3;
  const waistY = (g.shoulderY + g.hipY) / 2;
  const ww = Math.min(sw, hw) * 0.8;
  flesh.append(el('path', {
    d: `M ${g.cx - sw} ${g.shoulderY} L ${g.cx + sw} ${g.shoulderY} `
      + `Q ${g.cx + ww} ${waistY} ${g.cx + hw} ${g.hipY} `
      + `L ${g.cx - hw} ${g.hipY} `
      + `Q ${g.cx - ww} ${waistY} ${g.cx - sw} ${g.shoulderY} Z`,
    'stroke-width': 4,
  }));
  // 腕・脚・手足(骨組みと同じ経路を太いストロークで)
  for (const side of [-1, 1]) {
    const sx = g.cx + side * g.shoulderHalf;
    const ex = sx + side * 6;
    const elbowY = g.shoulderY + seg.upperArm * g.k;
    const wx = ex + side * 4;
    const wristY = elbowY + seg.forearm * g.k;
    flesh.append(el('path', {
      d: `M ${sx} ${g.shoulderY} L ${ex} ${elbowY} L ${wx} ${wristY}`,
      fill: 'none', 'stroke-width': armW,
    }));
    flesh.append(el('ellipse', {
      cx: wx + side * (seg.hand / 2) * g.k * 0.4,
      cy: wristY + (seg.hand / 2) * g.k,
      rx: Math.max(4, (seg.hand / 3) * g.k * 1.2),
      ry: (seg.hand / 2) * g.k * 1.1,
    }));
    const hx = g.cx + side * g.hipHalf;
    const kneeY = g.hipY + seg.thigh * g.k;
    const ankleY = kneeY + seg.shin * g.k;
    flesh.append(el('path', {
      d: `M ${hx} ${g.hipY} L ${hx} ${kneeY} L ${hx} ${ankleY}`,
      fill: 'none', 'stroke-width': legW,
    }));
    flesh.append(el('ellipse', {
      cx: hx + side * (seg.footLength / 2) * g.k * 0.6,
      cy: g.soleY - (seg.ankle / 2) * g.k,
      rx: (seg.footLength / 2) * g.k * 1.1,
      ry: Math.max(3, (seg.ankle / 2) * g.k * 1.2),
    }));
  }
  return flesh;
}

function fleshSide(seg, g) {
  const flesh = el('g', { class: 'flesh' });
  const bodyW = Math.max(6, g.shoulderHalf * 1.05); // 側面の胴の厚み
  const armW = Math.max(4, g.headR * 0.55);
  const legW = Math.max(5, g.headR * 0.85);
  const elbowY = g.shoulderY + seg.upperArm * g.k;
  const wristY = elbowY + seg.forearm * g.k;
  const kneeY = g.hipY + seg.thigh * g.k;
  const ankleY = kneeY + seg.shin * g.k;
  const footPx = seg.footLength * g.k;
  flesh.append(
    el('circle', { cx: g.cx + g.headR * 0.25, cy: g.top + g.headR, r: g.headR * 1.04 }),
    el('line', { x1: g.cx, y1: g.neckY - 2, x2: g.cx, y2: g.hipY, 'stroke-width': bodyW }),
    el('path', {
      d: `M ${g.cx} ${g.shoulderY} L ${g.cx - 5} ${elbowY} L ${g.cx - 2} ${wristY}`,
      fill: 'none', 'stroke-width': armW,
    }),
    el('path', {
      d: `M ${g.cx} ${g.hipY} L ${g.cx + 3} ${kneeY} L ${g.cx} ${ankleY}`,
      fill: 'none', 'stroke-width': legW,
    }),
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
