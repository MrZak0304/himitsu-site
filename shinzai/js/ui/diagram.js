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

// 骨組み=アルミ芯の形。頭・手・足は芯で作らない前提のため線に含めず、
// 位置の目安として点線の参考輪郭(.ref)で示す(2026-08-15 PDフィードバック。
// 「画像から」のテンプレート骨格と同じ構成)。

// 正面・背面共通の骨組み(左右対称)
function frontBones(seg, g) {
  const bones = el('g', { class: 'bones' });
  bones.append(
    // 頭の参考輪郭(芯ではない)
    el('circle', { class: 'ref', cx: g.cx, cy: g.top + g.headR, r: g.headR, fill: 'none' }),
    el('line', { x1: g.cx, y1: g.neckY, x2: g.cx, y2: g.hipY }),
    el('line', { x1: g.cx - g.shoulderHalf, y1: g.shoulderY, x2: g.cx + g.shoulderHalf, y2: g.shoulderY }),
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
      // 手の参考輪郭
      el('ellipse', {
        class: 'ref',
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
      // 脚は股(背骨の下端)から斜めに出す(「画像から」の骨格と同じ形)
      el('line', { x1: g.cx, y1: g.hipY, x2: hx, y2: kneeY }),
      el('line', { x1: hx, y1: kneeY, x2: hx, y2: ankleY }),
      // 足の参考輪郭
      el('ellipse', {
        class: 'ref',
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
    el('circle', {
      class: 'ref', cx: g.cx + g.headR * 0.25, cy: g.top + g.headR, r: g.headR, fill: 'none',
    }),
    el('line', { x1: g.cx, y1: g.neckY, x2: g.cx, y2: g.hipY }),
  );
  const elbowY = g.shoulderY + seg.upperArm * g.k;
  const wristY = elbowY + seg.forearm * g.k;
  bones.append(
    el('line', { x1: g.cx, y1: g.shoulderY, x2: g.cx - 5, y2: elbowY }),
    el('line', { x1: g.cx - 5, y1: elbowY, x2: g.cx - 2, y2: wristY }),
    el('ellipse', {
      class: 'ref',
      cx: g.cx - 2, cy: wristY + (seg.hand / 2) * g.k,
      rx: Math.max(3, (seg.hand / 3) * g.k), ry: (seg.hand / 2) * g.k, fill: 'none',
    }),
  );
  const kneeY = g.hipY + seg.thigh * g.k;
  const ankleY = kneeY + seg.shin * g.k;
  bones.append(
    el('line', { x1: g.cx, y1: g.hipY, x2: g.cx + 3, y2: kneeY }),
    el('line', { x1: g.cx + 3, y1: kneeY, x2: g.cx, y2: ankleY }),
    // 足の参考輪郭: かかと〜つま先(進行方向=右)
    el('line', { class: 'ref', x1: g.cx - footPx * 0.3, y1: g.soleY, x2: g.cx + footPx * 0.7, y2: g.soleY }),
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
    legW: Math.max(5, g.shoulderHalf * 0.92), // もも
    shinW: Math.max(4, g.shoulderHalf * 0.55), // すね
    neckW: Math.max(3, g.shoulderHalf * 0.4),
  };
}

function fleshFront(seg, g) {
  const flesh = el('g', { class: 'flesh' });
  const { armW, foreW, legW, shinW, neckW } = fleshWidths(g);
  const torsoH = g.hipY - g.shoulderY;
  const jawY = g.neckY; // あご下
  // 頭(針金の頭ループを覆う大きさの楕円)
  flesh.append(
    el('ellipse', { cx: g.cx, cy: g.top + g.headR, rx: g.headR * 0.98, ry: g.headR * 1.04 }),
  );
  // 胴を首つきの一体アウトライン(単一の閉パス。2分割だと中央に継ぎ目が出る):
  // 首(縦)→僧帽筋の傾斜→肩(三角筋の丸み)→脇→くびれ→腰→パンツライン→右側を鏡映で戻る
  const nw = neckW * 0.5; // 首の半幅
  const shTopY = g.shoulderY + armW * 0.2; // 肩(三角筋)の上面(肩バーの針金が収まる高さ)
  const neckRun = shTopY - jawY;
  const sw = g.shoulderHalf; // 肩先
  const cw = sw * 0.88; // 脇(胸横)
  const chestY = g.shoulderY + torsoH * 0.34;
  const hw = Math.max(g.hipHalf * 1.35, sw * 0.72); // 腰の張り
  const ww = Math.min(sw, hw) * 0.74; // ウエスト
  const waistY = g.shoulderY + torsoH * 0.6;
  const crotchY = g.hipY + legW * 0.75; // 内ももまで埋まる深さ
  flesh.append(el('path', {
    d: `M ${g.cx - nw} ${jawY - 2}`
      + ` L ${g.cx - nw} ${jawY + neckRun * 0.4}`
      + ` C ${g.cx - nw} ${jawY + neckRun * 0.85} ${g.cx - sw * 0.5} ${shTopY - armW * 0.3} ${g.cx - sw * 0.9} ${shTopY}`
      + ` C ${g.cx - sw * 1.12} ${shTopY + armW * 0.45} ${g.cx - sw * 1.05} ${shTopY + armW * 1.05} ${g.cx - cw} ${chestY}`
      + ` C ${g.cx - cw * 0.94} ${chestY + torsoH * 0.1} ${g.cx - ww * 1.04} ${waistY - torsoH * 0.07} ${g.cx - ww} ${waistY}`
      + ` C ${g.cx - ww * 0.98} ${waistY + torsoH * 0.1} ${g.cx - hw} ${g.hipY - torsoH * 0.14} ${g.cx - hw} ${g.hipY}`
      + ` Q ${g.cx - hw * 0.5} ${crotchY + legW * 0.3} ${g.cx} ${crotchY}`
      + ` Q ${g.cx + hw * 0.5} ${crotchY + legW * 0.3} ${g.cx + hw} ${g.hipY}`
      + ` C ${g.cx + hw} ${g.hipY - torsoH * 0.14} ${g.cx + ww * 0.98} ${waistY + torsoH * 0.1} ${g.cx + ww} ${waistY}`
      + ` C ${g.cx + ww * 1.04} ${waistY - torsoH * 0.07} ${g.cx + cw * 0.94} ${chestY + torsoH * 0.1} ${g.cx + cw} ${chestY}`
      + ` C ${g.cx + sw * 1.05} ${shTopY + armW * 1.05} ${g.cx + sw * 1.12} ${shTopY + armW * 0.45} ${g.cx + sw * 0.9} ${shTopY}`
      + ` C ${g.cx + sw * 0.5} ${shTopY - armW * 0.3} ${g.cx + nw} ${jawY + neckRun * 0.85} ${g.cx + nw} ${jawY + neckRun * 0.4}`
      + ` L ${g.cx + nw} ${jawY - 2} Z`,
  }));
  for (const side of [-1, 1]) {
    const sx = g.cx + side * g.shoulderHalf;
    const ex = sx + side * 6;
    const elbowY = g.shoulderY + seg.upperArm * g.k;
    const wx = ex + side * 4;
    const wristY = elbowY + seg.forearm * g.k;
    // 腕: 上腕(太)→前腕(細)のテーパー+ヒジの丸みでつなぐ+手は腕の延長線上
    flesh.append(
      el('line', { x1: sx, y1: g.shoulderY + armW * 0.4, x2: ex, y2: elbowY, 'stroke-width': armW }),
      el('circle', { cx: ex, cy: elbowY, r: foreW * 0.62 }),
      el('line', { x1: ex, y1: elbowY, x2: wx, y2: wristY, 'stroke-width': foreW }),
      el('ellipse', {
        cx: wx + side * (seg.hand / 8) * g.k,
        cy: wristY + (seg.hand / 2.3) * g.k,
        rx: Math.max(3, (seg.hand / 3.6) * g.k),
        ry: (seg.hand / 2.1) * g.k,
      }),
    );
    // 脚: もも(太)→すね(細)のテーパー+ヒザの丸み+接地する足
    // 足は正面視の奥行き縮みを表現して実寸より短く描く(実寸は側面図の注記が持つ)
    const hx = g.cx + side * g.hipHalf;
    const kneeY = g.hipY + seg.thigh * g.k;
    const ankleY = kneeY + seg.shin * g.k;
    const footR = (seg.footLength / 2) * g.k * 0.62;
    flesh.append(
      el('line', { x1: hx, y1: g.hipY, x2: hx, y2: kneeY, 'stroke-width': legW }),
      el('circle', { cx: hx, cy: kneeY, r: shinW * 0.62 }),
      el('line', { x1: hx, y1: kneeY, x2: hx, y2: ankleY, 'stroke-width': shinW }),
      // 足: かかと(内側)→足首→つま先(外側)の、地面に接する丸みのある形
      el('path', {
        d: `M ${hx - side * footR * 0.5} ${g.soleY}`
          + ` Q ${hx - side * footR * 0.55} ${g.soleY - seg.ankle * g.k} ${hx} ${ankleY + seg.ankle * g.k * 0.2}`
          + ` Q ${hx + side * footR * 0.9} ${g.soleY - seg.ankle * g.k * 0.9} ${hx + side * footR * 1.05} ${g.soleY - 1}`
          + ' Z',
      }),
    );
  }
  return flesh;
}

function fleshSide(seg, g) {
  // 側面は「背骨=軸が体のやや後ろ寄りを通る直立姿勢」の一体輪郭で描く。
  // 軸(針金)は真っ直ぐのまま体の中に収まる=肉付け図と芯の矛盾を作らない
  // (2026-08-15 PDフィードバック第6弾)。
  const flesh = el('g', { class: 'flesh' });
  const { armW, foreW, legW, shinW, neckW } = fleshWidths(g);
  const d = Math.max(8, g.shoulderHalf * 1.15); // 体の厚み(前後幅)の基準
  const cx = g.cx;
  const jawY = g.neckY;
  const shTopY = g.shoulderY + armW * 0.2;
  const torsoH = g.hipY - g.shoulderY;
  const chestY = g.shoulderY + torsoH * 0.3;
  const waistY = g.shoulderY + torsoH * 0.62;
  const kneeY = g.hipY + seg.thigh * g.k;
  const ankleY = kneeY + seg.shin * g.k;
  const calfY = kneeY + (ankleY - kneeY) * 0.3;
  const buttY = g.hipY + legW * 0.2;
  const underButtY = g.hipY + legW * 0.85;
  const footPx = seg.footLength * g.k;
  const nw = neckW * 0.55;
  const elbowY = g.shoulderY + seg.upperArm * g.k;
  const wristY = elbowY + seg.forearm * g.k;
  // 頭(前寄りの楕円)
  flesh.append(el('ellipse', {
    cx: cx + g.headR * 0.18, cy: g.top + g.headR, rx: g.headR * 0.98, ry: g.headR * 1.04,
  }));
  // 首前→胸→腹→もも前→すね前→つま先→かかと→ふくらはぎ→もも裏→お尻→背中→首うしろ
  flesh.append(el('path', {
    d: `M ${cx + nw} ${jawY - 2}`
      + ` C ${cx + nw} ${jawY + (shTopY - jawY) * 0.7} ${cx + d * 0.5} ${chestY - torsoH * 0.12} ${cx + d * 0.52} ${chestY}`
      + ` C ${cx + d * 0.5} ${chestY + torsoH * 0.14} ${cx + d * 0.34} ${waistY - torsoH * 0.06} ${cx + d * 0.33} ${waistY}`
      + ` C ${cx + d * 0.32} ${waistY + torsoH * 0.14} ${cx + d * 0.3} ${g.hipY - torsoH * 0.08} ${cx + d * 0.26} ${g.hipY + legW * 0.3}`
      + ` C ${cx + d * 0.2} ${underButtY + (kneeY - underButtY) * 0.4} ${cx + shinW * 0.65} ${kneeY - (kneeY - underButtY) * 0.2} ${cx + shinW * 0.6} ${kneeY}`
      + ` C ${cx + shinW * 0.55} ${kneeY + (ankleY - kneeY) * 0.4} ${cx + shinW * 0.4} ${ankleY - (ankleY - kneeY) * 0.2} ${cx + shinW * 0.38} ${ankleY}`
      + ` Q ${cx + footPx * 0.55} ${g.soleY - seg.ankle * g.k * 0.5} ${cx + footPx * 0.72} ${g.soleY - 1}`
      + ` L ${cx - footPx * 0.28} ${g.soleY - 1}`
      + ` Q ${cx - shinW * 0.5} ${ankleY + (g.soleY - ankleY) * 0.3} ${cx - shinW * 0.45} ${ankleY}`
      + ` C ${cx - shinW * 0.95} ${calfY + (ankleY - calfY) * 0.4} ${cx - shinW * 1.0} ${calfY} ${cx - shinW * 0.7} ${kneeY - (kneeY - underButtY) * 0.15}`
      + ` C ${cx - d * 0.28} ${underButtY + (kneeY - underButtY) * 0.2} ${cx - d * 0.32} ${underButtY} ${cx - d * 0.4} ${underButtY - legW * 0.25}`
      + ` C ${cx - d * 0.62} ${buttY + legW * 0.3} ${cx - d * 0.58} ${buttY - legW * 0.2} ${cx - d * 0.38} ${waistY + torsoH * 0.08}`
      + ` C ${cx - d * 0.36} ${waistY - torsoH * 0.05} ${cx - d * 0.5} ${chestY + torsoH * 0.1} ${cx - d * 0.48} ${chestY}`
      + ` C ${cx - d * 0.46} ${chestY - torsoH * 0.1} ${cx - nw * 1.6} ${shTopY} ${cx - nw * 1.1} ${jawY + (shTopY - jawY) * 0.4}`
      + ` L ${cx - nw * 1.1} ${jawY - 2} Z`,
  }));
  // 腕(体の輪郭の上に重ねる)+手の参考位置
  flesh.append(
    el('line', { x1: cx, y1: g.shoulderY + armW * 0.3, x2: cx - 5, y2: elbowY, 'stroke-width': armW }),
    el('circle', { cx: cx - 5, cy: elbowY, r: foreW * 0.62 }),
    el('line', { x1: cx - 5, y1: elbowY, x2: cx - 2, y2: wristY, 'stroke-width': foreW }),
    el('ellipse', {
      cx: cx - 2, cy: wristY + (seg.hand / 2.3) * g.k,
      rx: Math.max(3, (seg.hand / 3.6) * g.k), ry: (seg.hand / 2.1) * g.k,
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
    // 肉付け表示中は骨格線を薄くしてシルエットを主役にする(CSS側で .with-flesh .bones を減light)
    class: flesh ? 'with-flesh' : '',
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
