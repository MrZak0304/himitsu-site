// js/ui/posefig.js — 三面図の統一レンダラー(通常表示・ポーズモード共通)。
// 3D関節(js/core/pose3d.js)を正面・左側面・右側面に投影して描く。
//   ・骨格(芯)は関節を結ぶ線+首/手首/足首の接続しろ+頭・手・足の参考輪郭
//   ・肉付けシルエットも関節位置から描く(胴は背骨の局所座標系で定義し、ポーズに追従)
//     → ポーズON/OFFで見た目が変わらない(2026-08-15 PDフィードバック第12弾)
//   ・interactive のとき関節をドラッグでき、どの面で動かしても他の面が連動する
//   ・寸法注記は直立(未ポーズ)のときだけ表示

import {
  restPose, boneLengths, dragJoint, resetJoint, project, isPosed, neckStubEnd,
  BONES, FOOT_BONES, DRAGGABLE, JOINT_LABELS,
} from '../core/pose3d.js';
import { dimLineV, dimLineH, geometry, VIEW_W, VIEW_H } from './diagram.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWS = [['front', '正面'], ['side-left', '左側面'], ['side-right', '右側面']];

function el(name, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}
const fmt = (n) => Math.round(n * 100) / 100;

// container: 三面図を入れる要素 / seg: computeArmature().segments
// opts: { flesh, interactive, initialJoints, onStatus, onPoseChange, onJointPick }
export function createPoseFigure(container, seg, opts = {}) {
  const interactive = opts.interactive !== false;
  const rest = restPose(seg);
  const lengths = boneLengths(rest);
  let joints = opts.initialJoints ?? rest;
  const svgs = {};
  const g = geometry(seg);
  const k = g.k;
  const hipPx = { x: g.cx, y: g.hipY };
  const toPx = (p, view) => {
    const { u, v } = project(p, view);
    return { x: hipPx.x + u * k, y: hipPx.y + v * k };
  };
  const fromPx = (px) => ({ u: (px.x - hipPx.x) / k, v: (px.y - hipPx.y) / k });

  // 太さの基準: 肩幅と頭高×1.5の小さい方(肩幅だけ広げても頭が埋まらない)
  const unit = Math.min(seg.shoulderWidth, seg.head * 1.5) * k;
  const W = {
    arm: Math.max(4, unit * 0.3), fore: Math.max(3, unit * 0.24),
    leg: Math.max(5, unit * 0.44), shin: Math.max(4, unit * 0.32),
    neck: Math.max(3, unit * 0.24), depth: Math.max(8, unit * 0.62),
  };
  const headR = g.headR;

  // ---- 幾何ヘルパー(2D px) ----
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  const norm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
  const perp = (a) => ({ x: -a.y, y: a.x }); // 左回り90°
  const P = (pt) => `${fmt(pt.x)} ${fmt(pt.y)}`;

  function headGeom(view) {
    const n = toPx(joints.neck, view);
    const t = toPx(joints.top, view);
    const dir = norm(sub(t, n));
    const fwd = view === 'front' ? 0 : (view === 'side-right' ? 1 : -1);
    return { c: add(add(n, mul(dir, headR)), { x: fwd * headR * 0.18, y: 0 }), r: headR, dir };
  }

  // 胴の輪郭(正面/背面系): 首→僧帽筋→肩→脇→くびれ→腰→股 を関節から組み立てる
  function torsoFrontPath(view) {
    const st = toPx(joints.spineTop, view);
    const hp = toPx(joints.hip, view);
    const nk = toPx(joints.neck, view);
    const sl = toPx(joints.shoulderL, view);
    const sr = toPx(joints.shoulderR, view);
    const hl = toPx(joints.hipL, view);
    const hr = toPx(joints.hipR, view);
    const up = norm(sub(st, hp)); // 背骨の向き(上)
    const side = perp(up); // 体の左右方向(画面で右手側)
    const spread = (a, b) => Math.abs((a.x - b.x) * side.x + (a.y - b.y) * side.y) / 2;
    const sw = Math.max(spread(sl, sr), W.neck); // 肩の半幅(投影後)
    const hw = Math.max(spread(hl, hr) * 1.35, sw * 0.5, W.leg * 0.9); // 腰の張り
    const ww = Math.min(sw, hw) * 0.74; // ウエスト
    const torsoH = Math.hypot(st.x - hp.x, st.y - hp.y);
    const at = (t, s) => add(add(hp, mul(up, t * torsoH)), mul(side, s)); // t: 0=股,1=首つけ根
    const nw = W.neck * 0.5;
    const shTop = 1 - (W.arm * 0.2) / torsoH;
    const neckLen = Math.hypot(nk.x - st.x, nk.y - st.y);
    const jaw = 1 + neckLen / torsoH;
    const chest = 0.66; const waist = 0.4; const crotch = -(W.leg * 0.75) / torsoH;
    const cw = sw * 0.88;
    const L = (s) => -s; const R = (s) => s;
    const half = (S) =>
      ` L ${P(at(jaw - (jaw - shTop) * 0.4, S(nw)))}`
      + ` C ${P(at(jaw - (jaw - shTop) * 0.85, S(nw)))} ${P(at(shTop + 0.02, S(sw * 0.5)))} ${P(at(shTop, S(sw * 0.9)))}`
      + ` C ${P(at(shTop - 0.06, S(sw * 1.12)))} ${P(at(shTop - 0.14, S(sw * 1.05)))} ${P(at(chest, S(cw)))}`
      + ` C ${P(at(chest - 0.1, S(cw * 0.94)))} ${P(at(waist + 0.07, S(ww * 1.04)))} ${P(at(waist, S(ww)))}`
      + ` C ${P(at(waist - 0.1, S(ww * 0.98)))} ${P(at(0.14, S(hw)))} ${P(at(0, S(hw)))}`
      + ` Q ${P(at(crotch - 0.03, S(hw * 0.5)))} ${P(at(crotch, 0))}`;
    // 左側を下り、右側を鏡映で上る
    const rightUp = (S) =>
      ` Q ${P(at(crotch - 0.03, S(hw * 0.5)))} ${P(at(0, S(hw)))}`
      + ` C ${P(at(0.14, S(hw)))} ${P(at(waist - 0.1, S(ww * 0.98)))} ${P(at(waist, S(ww)))}`
      + ` C ${P(at(waist + 0.07, S(ww * 1.04)))} ${P(at(chest - 0.1, S(cw * 0.94)))} ${P(at(chest, S(cw)))}`
      + ` C ${P(at(shTop - 0.14, S(sw * 1.05)))} ${P(at(shTop - 0.06, S(sw * 1.12)))} ${P(at(shTop, S(sw * 0.9)))}`
      + ` C ${P(at(shTop + 0.02, S(sw * 0.5)))} ${P(at(jaw - (jaw - shTop) * 0.85, S(nw)))} ${P(at(jaw - (jaw - shTop) * 0.4, S(nw)))}`
      + ` L ${P(at(jaw, S(nw)))}`;
    return `M ${P(at(jaw, L(nw)))}${half(L)}${rightUp(R)} Z`;
  }

  // 胴の輪郭(側面): 背骨の局所座標系(前方向=fwd)で胸・腹・尻のカーブ
  function torsoSidePath(view) {
    const st = toPx(joints.spineTop, view);
    const hp = toPx(joints.hip, view);
    const nk = toPx(joints.neck, view);
    const up = norm(sub(st, hp));
    let fwd = perp(up); // 前方向候補
    const want = view === 'side-right' ? 1 : -1;
    if (Math.sign(fwd.x) !== want) fwd = mul(fwd, -1);
    const torsoH = Math.hypot(st.x - hp.x, st.y - hp.y);
    const at = (t, s) => add(add(hp, mul(up, t * torsoH)), mul(fwd, s));
    const d = W.depth;
    const neckLen = Math.hypot(nk.x - st.x, nk.y - st.y);
    const jaw = 1 + neckLen / torsoH;
    const nw = W.neck * 0.55;
    const shTop = 1 - (W.arm * 0.2) / torsoH;
    const butt = -(W.leg * 0.2) / torsoH;
    const under = -(W.leg * 0.85) / torsoH;
    return `M ${P(at(jaw, nw))}`
      + ` C ${P(at(jaw - (jaw - shTop) * 0.7, nw))} ${P(at(0.82, d * 0.5))} ${P(at(0.7, d * 0.52))}`
      + ` C ${P(at(0.56, d * 0.5))} ${P(at(0.44, d * 0.34))} ${P(at(0.38, d * 0.33))}`
      + ` C ${P(at(0.24, d * 0.32))} ${P(at(0.08, d * 0.3))} ${P(at(-0.06, d * 0.26))}`
      + ` C ${P(at(under, d * 0.2))} ${P(at(under, -d * 0.1))} ${P(at(under - 0.02, -d * 0.4))}`
      + ` C ${P(at(butt, -d * 0.62))} ${P(at(butt + 0.08, -d * 0.58))} ${P(at(0.32, -d * 0.38))}`
      + ` C ${P(at(0.45, -d * 0.36))} ${P(at(0.6, -d * 0.5))} ${P(at(0.7, -d * 0.48))}`
      + ` C ${P(at(0.8, -d * 0.46))} ${P(at(shTop, -nw * 1.6))} ${P(at(jaw - (jaw - shTop) * 0.6, -nw * 1.1))}`
      + ` L ${P(at(jaw, -nw * 1.1))} Z`;
  }

  // 手・足の参考輪郭(骨の延長線上に置く)
  function handEllipse(view, side) {
    const e = toPx(joints[`elbow${side}`], view);
    const w = toPx(joints[`wrist${side}`], view);
    const dir = norm(sub(w, e));
    const c = add(w, mul(dir, (seg.hand / 2) * k));
    const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI - 90;
    return { c, rx: Math.max(3, (seg.hand / 3.4) * k), ry: (seg.hand / 2) * k, ang };
  }
  // 足: 足首→つま先の関節から形を決める(つま先を動かすと足の向きが変わる)
  function footShape(view, side) {
    const an = toPx(joints[`ankle${side}`], view);
    const to = toPx(joints[`toe${side}`], view);
    const kn = toPx(joints[`knee${side}`], view);
    const footPx = seg.footLength * k;
    const ankPx = seg.ankle * k;
    const v = sub(to, an);
    const l = Math.hypot(v.x, v.y);
    // 投影で足がほぼ点になる(真正面から見た足など)ときは、すねの向きを基準にする
    const dir = l > 2 ? mul(v, 1 / l) : norm(sub(an, kn));
    const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    if (view === 'front') {
      // 正面: 足首の少し先に、足の向きに沿った楕円(奥行きぶんは短く見える)
      const along = Math.max(ankPx * 0.6, l * 0.5);
      const c = add(an, mul(dir, along));
      return { kind: 'ellipse', c, rx: along * 0.9, ry: Math.max(3, (footPx / 2) * 0.62), ang };
    }
    // 側面: かかと→つま先の線
    const heelBack = Math.max(footPx * 0.3, l * 0.3);
    return {
      kind: 'line',
      a: add(an, mul(dir, -heelBack * 0.6)),
      b: to,
      w: Math.max(4, ankPx),
    };
  }

  function buildView(view) {
    const svg = el('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      class: `pose-svg${opts.flesh ? ' with-flesh' : ''}${interactive ? '' : ' static'}`,
      role: 'img',
      'aria-label': `骨格図(${VIEWS.find((v) => v[0] === view)[1]})`,
    });
    const flesh = el('g', { class: 'flesh' });
    // 描画順: 奥の腕脚 → 胴 → 手前の腕脚 → 首・頭。側面は奥側(反対の腕脚)を先に描く
    const sides = view === 'side-right' ? ['L', 'R'] : ['R', 'L'];
    const limbs = (s) => {
      const g2 = el('g', { class: 'limbs', 'data-side': s });
      g2.append(
        el('line', { class: `limb upper`, 'data-seg': `shoulder${s}-elbow${s}` }),
        el('circle', { class: 'joint-round', 'data-at': `elbow${s}`, r: W.fore * 0.62 }),
        el('line', { class: `limb lower`, 'data-seg': `elbow${s}-wrist${s}` }),
        el('ellipse', { class: 'hand', 'data-side': s }),
        el('line', { class: `limb thigh`, 'data-seg': `hip${s}-knee${s}` }),
        el('circle', { class: 'joint-round', 'data-at': `knee${s}`, r: W.shin * 0.62 }),
        el('line', { class: `limb shin`, 'data-seg': `knee${s}-ankle${s}` }),
        el('ellipse', { class: 'foot-e', 'data-side': s }),
        el('line', { class: 'foot-l', 'data-side': s }),
      );
      return g2;
    };
    flesh.append(limbs(sides[0]), el('path', { class: 'torso' }), limbs(sides[1]));
    flesh.append(el('line', { class: 'neck' }), el('ellipse', { class: 'head-flesh' }));

    const bones = el('g', { class: 'bones' });
    bones.append(el('circle', { class: 'ref head-ref' }), el('line', { class: 'neck-stub' }));
    for (const [a, b] of BONES) bones.append(el('line', { 'data-bone': `${a}-${b}` }));
    for (const [a, b] of FOOT_BONES) bones.append(el('line', { class: 'ref foot-bone', 'data-bone': `${a}-${b}` }));
    for (const s of ['L', 'R']) {
      bones.append(
        el('line', { class: 'stub', 'data-stub': `wrist${s}` }),
        el('line', { class: 'stub', 'data-stub': `ankle${s}` }),
        el('ellipse', { class: 'ref hand-ref', 'data-side': s }),
        el('ellipse', { class: 'ref foot-ref-e', 'data-side': s }),
        el('line', { class: 'ref foot-ref-l', 'data-side': s }),
      );
    }
    const dims = el('g', { class: 'dims' });
    const jointsG = el('g', { class: 'pose-joints' });
    if (interactive) {
      for (const id of DRAGGABLE) {
        const hit = el('circle', { class: 'pose-hit', 'data-joint': id, r: 22 });
        const t = el('title'); t.textContent = JOINT_LABELS[id]; hit.append(t);
        hit.addEventListener('pointerdown', (ev) => startDrag(ev, id, view));
        jointsG.append(el('circle', { class: 'pose-dot', 'data-joint': id, r: 6 }), hit);
      }
      svg.addEventListener('touchmove', (ev) => ev.preventDefault(), { passive: false });
    }
    svg.append(flesh, bones, dims, jointsG);
    return svg;
  }

  function setLine(node, a, b) {
    node.setAttribute('x1', fmt(a.x)); node.setAttribute('y1', fmt(a.y));
    node.setAttribute('x2', fmt(b.x)); node.setAttribute('y2', fmt(b.y));
  }
  function setEllipse(node, e) {
    node.setAttribute('cx', fmt(e.c.x)); node.setAttribute('cy', fmt(e.c.y));
    node.setAttribute('rx', fmt(e.rx)); node.setAttribute('ry', fmt(e.ry));
    node.setAttribute('transform', `rotate(${fmt(e.ang ?? 0)} ${fmt(e.c.x)} ${fmt(e.c.y)})`);
  }

  function redraw() {
    const posed = isPosed(joints, rest);
    for (const [view, svg] of Object.entries(svgs)) {
      // 骨格
      for (const line of svg.querySelectorAll('line[data-bone]')) {
        const [a, b] = line.dataset.bone.split('-');
        setLine(line, toPx(joints[a], view), toPx(joints[b], view));
      }
      const hg = headGeom(view);
      const headRef = svg.querySelector('.head-ref');
      headRef.setAttribute('cx', fmt(hg.c.x)); headRef.setAttribute('cy', fmt(hg.c.y)); headRef.setAttribute('r', fmt(hg.r));
      setLine(svg.querySelector('.neck-stub'), toPx(joints.neck, view), toPx(neckStubEnd(joints, seg.head), view));
      for (const s of ['L', 'R']) {
        // 接続しろ: 手首の先(手長4割)・足首の先(足裏+つま先側)
        const e = toPx(joints[`elbow${s}`], view); const w = toPx(joints[`wrist${s}`], view);
        setLine(svg.querySelector(`.stub[data-stub=wrist${s}]`), w, add(w, mul(norm(sub(w, e)), seg.hand * 0.4 * k)));
        const kn = toPx(joints[`knee${s}`], view); const an = toPx(joints[`ankle${s}`], view);
        setLine(svg.querySelector(`.stub[data-stub=ankle${s}]`), an, add(an, mul(norm(sub(an, kn)), seg.ankle * k)));
        setEllipse(svg.querySelector(`.hand-ref[data-side=${s}]`), handEllipse(view, s));
        const f = footShape(view, s);
        const fe = svg.querySelector(`.foot-ref-e[data-side=${s}]`);
        const fl = svg.querySelector(`.foot-ref-l[data-side=${s}]`);
        if (f.kind === 'ellipse') { setEllipse(fe, f); fe.style.display = ''; fl.style.display = 'none'; }
        else { setLine(fl, f.a, f.b); fl.style.display = ''; fe.style.display = 'none'; }
      }
      // 肉付け
      const torso = svg.querySelector('.flesh .torso');
      torso.setAttribute('d', view === 'front' ? torsoFrontPath(view) : torsoSidePath(view));
      for (const line of svg.querySelectorAll('.flesh line[data-seg]')) {
        const [a, b] = line.dataset.seg.split('-');
        setLine(line, toPx(joints[a], view), toPx(joints[b], view));
        line.setAttribute('stroke-width', line.classList.contains('upper') ? W.arm
          : line.classList.contains('lower') ? W.fore
            : line.classList.contains('thigh') ? W.leg : W.shin);
      }
      for (const c of svg.querySelectorAll('.flesh .joint-round')) {
        const p = toPx(joints[c.dataset.at], view);
        c.setAttribute('cx', fmt(p.x)); c.setAttribute('cy', fmt(p.y));
      }
      for (const h of svg.querySelectorAll('.flesh .hand')) setEllipse(h, handEllipse(view, h.dataset.side));
      for (const s of svg.querySelectorAll('.flesh .foot-e')) {
        const f = footShape(view, s.dataset.side);
        const l = svg.querySelector(`.flesh .foot-l[data-side=${s.dataset.side}]`);
        if (f.kind === 'ellipse') { setEllipse(s, f); s.style.display = ''; l.style.display = 'none'; }
        else { setLine(l, f.a, f.b); l.setAttribute('stroke-width', f.w); l.style.display = ''; s.style.display = 'none'; }
      }
      const neck = svg.querySelector('.flesh .neck');
      setLine(neck, toPx(joints.neck, view), toPx(joints.spineTop, view));
      neck.setAttribute('stroke-width', W.neck);
      setEllipse(svg.querySelector('.head-flesh'), { c: hg.c, rx: hg.r * 0.98, ry: hg.r * 1.04, ang: 0 });
      // 関節
      for (const c of svg.querySelectorAll('circle[data-joint]')) {
        const p = toPx(joints[c.dataset.joint], view);
        c.setAttribute('cx', fmt(p.x)); c.setAttribute('cy', fmt(p.y));
      }
      // 寸法注記(直立のときだけ)
      const dims = svg.querySelector('.dims');
      dims.replaceChildren();
      if (!posed) appendDims(dims, view);
    }
  }

  function appendDims(dims, view) {
    const kneeY = g.hipY + seg.thigh * k;
    const ankleY = kneeY + seg.shin * k;
    if (view === 'front') {
      const rightX = g.cx + Math.max(g.shoulderHalf, g.hipHalf) + 52;
      dims.append(
        dimLineH(g.top - 14, g.cx - g.shoulderHalf, g.cx + g.shoulderHalf, `肩幅 ${seg.shoulderWidth}cm`),
        dimLineV(rightX, g.top, g.hipY, `頭〜腰 ${seg.headTopToHip}cm`),
        dimLineV(rightX, g.hipY, g.soleY, `腰〜足先 ${seg.hipToSole}cm`),
        dimLineV(g.cx - g.shoulderHalf - 36, g.shoulderY, g.shoulderY + seg.armTotal * k, `腕 ${seg.armTotal}cm`, 'end'),
      );
    } else if (view === 'side-left') {
      dims.append(dimLineV(g.cx + g.headR + 50, g.top, g.soleY, `全高 ${seg.figureHeight}cm`));
    } else {
      dims.append(
        dimLineH(g.soleY + 24, g.cx - seg.footLength * k * 0.3, g.cx + seg.footLength * k * 0.7, `足 ${seg.footLength}cm`),
        dimLineV(g.cx + 50, g.hipY, kneeY, `もも ${seg.thigh}cm`),
        dimLineV(g.cx + 50, kneeY, ankleY, `すね ${seg.shin}cm`),
      );
    }
  }

  function svgPoint(svg, ev) {
    const r = svg.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * VIEW_W, y: ((ev.clientY - r.top) / r.height) * VIEW_H };
  }

  let lastJoint = null;
  function startDrag(ev, id, view) {
    ev.preventDefault();
    ev.stopPropagation();
    const svg = svgs[view];
    const pointerId = ev.pointerId;
    try { ev.currentTarget.setPointerCapture(pointerId); } catch { /* window監視で継続 */ }
    lastJoint = id;
    opts.onJointPick?.(id, JOINT_LABELS[id]);
    opts.onStatus?.(`「${JOINT_LABELS[id]}」を動かしています(骨の長さは変わりません。他の面も連動します)`);
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      joints = dragJoint(joints, lengths, id, fromPx(svgPoint(svg, e)), view);
      redraw();
    };
    const up = (e) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      opts.onPoseChange?.(joints, isPosed(joints, rest));
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function mount() {
    container.replaceChildren();
    for (const [view, label] of VIEWS) {
      const fig = document.createElement('figure');
      fig.className = 'view pose-view';
      const svg = buildView(view);
      svgs[view] = svg;
      fig.append(svg);
      const cap = document.createElement('figcaption');
      cap.textContent = label;
      fig.append(cap);
      container.append(fig);
    }
    redraw();
  }

  mount();
  return {
    reset() {
      joints = rest;
      redraw();
      opts.onPoseChange?.(joints, false);
    },
    resetJoint(id = lastJoint) {
      if (!id) return;
      joints = resetJoint(joints, lengths, rest, id);
      redraw();
      opts.onPoseChange?.(joints, isPosed(joints, rest));
    },
    lastJoint: () => lastJoint,
    getJoints: () => joints,
    isPosed: () => isPosed(joints, rest),
    setFlesh(on) {
      for (const svg of Object.values(svgs)) svg.classList.toggle('with-flesh', !!on);
    },
  };
}
