// js/ui/posefig.js — 三面図の連動ポーズ(UI)。
// 3D関節(js/core/pose3d.js)を正面・左側面・右側面に投影して描き、どの面の関節を
// ドラッグしても他の面が連動する。骨長は不変=切り出し寸法は変わらない(曲げ位置の指示図)。
// ポーズ中の肉付けは立ち姿用シルエットが追従できないためカプセル表示に切り替える。

import {
  restPose, boneLengths, dragJoint, project, isPosed, BONES, DRAGGABLE, JOINT_LABELS,
} from '../core/pose3d.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 340;
const VIEW_H = 460;
const VIEWS = [['front', '正面'], ['side-left', '左側面'], ['side-right', '右側面']];

function el(name, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

// container: 三面図を入れる要素 / seg: computeArmature().segments
// opts.flesh: 肉付け表示 / opts.onStatus: 操作ガイド通知 / opts.onPoseChange: ポーズ変化通知
export function createPoseFigure(container, seg, opts = {}) {
  const rest = restPose(seg);
  const lengths = boneLengths(rest);
  let joints = opts.initialJoints ?? rest;
  const svgs = {}; // view → svg
  const H = seg.figureHeight;
  const pad = 36;
  const k = (VIEW_H - pad * 2) / H; // cm → px
  const cx = VIEW_W / 2 - 20;
  // 股(原点)の描画位置: 頭頂が pad に来るように
  const hipPx = { x: cx, y: pad + seg.headTopToHip * k };
  const toPx = (p, view) => {
    const { u, v } = project(p, view);
    return { x: hipPx.x + u * k, y: hipPx.y + v * k };
  };
  const fromPx = (px, view) => ({ u: (px.x - hipPx.x) / k, v: (px.y - hipPx.y) / k });

  function headCenter(view) {
    // 頭は首(neck)〜top の延長線上の円として描く(芯ではない参考輪郭)
    const n = toPx(joints.neck, view);
    const t = toPx(joints.top, view);
    const r = (seg.head / 2) * k;
    const dx = t.x - n.x; const dy = t.y - n.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: n.x + (dx / l) * r, y: n.y + (dy / l) * r, r };
  }

  function buildView(view) {
    const svg = el('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      class: `pose-svg${opts.flesh ? ' with-flesh' : ''}`,
      role: 'img',
      'aria-label': `骨格図(${VIEWS.find((v) => v[0] === view)[1]})`,
    });
    const fleshG = el('g', { class: 'flesh capsules' });
    const bonesG = el('g', { class: 'bones' });
    const jointsG = el('g', { class: 'pose-joints' });
    // 頭の参考輪郭
    bonesG.append(el('circle', { class: 'ref head-ref' }));
    for (const [a, b] of BONES) {
      bonesG.append(el('line', { 'data-bone': `${a}-${b}` }));
      fleshG.append(el('line', { 'data-capsule': `${a}-${b}` }));
    }
    fleshG.append(el('circle', { class: 'head-flesh' }));
    for (const id of DRAGGABLE) {
      const hit = el('circle', { class: 'pose-hit', 'data-joint': id, r: 14 });
      hit.append(titleEl(JOINT_LABELS[id]));
      hit.addEventListener('pointerdown', (ev) => startDrag(ev, id, view));
      const dot = el('circle', { class: 'pose-dot', 'data-joint': id, r: 5 });
      jointsG.append(dot, hit);
    }
    svg.append(fleshG, bonesG, jointsG);
    svg.addEventListener('touchmove', (ev) => ev.preventDefault(), { passive: false });
    return svg;
  }

  function titleEl(text) {
    const t = el('title');
    t.textContent = text;
    return t;
  }

  function redraw() {
    for (const [view, svg] of Object.entries(svgs)) {
      for (const line of svg.querySelectorAll('line[data-bone]')) {
        const [a, b] = line.dataset.bone.split('-');
        const pa = toPx(joints[a], view); const pb = toPx(joints[b], view);
        line.setAttribute('x1', pa.x); line.setAttribute('y1', pa.y);
        line.setAttribute('x2', pb.x); line.setAttribute('y2', pb.y);
      }
      for (const line of svg.querySelectorAll('line[data-capsule]')) {
        const [a, b] = line.dataset.capsule.split('-');
        const pa = toPx(joints[a], view); const pb = toPx(joints[b], view);
        line.setAttribute('x1', pa.x); line.setAttribute('y1', pa.y);
        line.setAttribute('x2', pb.x); line.setAttribute('y2', pb.y);
        line.setAttribute('stroke-width', capsuleWidth(a, b));
      }
      const hc = headCenter(view);
      for (const c of svg.querySelectorAll('.head-ref, .head-flesh')) {
        c.setAttribute('cx', hc.x); c.setAttribute('cy', hc.y); c.setAttribute('r', hc.r);
      }
      for (const c of svg.querySelectorAll('circle[data-joint]')) {
        const p = toPx(joints[c.dataset.joint], view);
        c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
      }
    }
  }

  // カプセル(ポーズ中の簡易肉付け)の太さ: 部位ごとに肩幅基準
  function capsuleWidth(a, b) {
    const sh = seg.shoulderWidth * k;
    if (a === 'hip' && b === 'spineTop') return sh * 0.9; // 胴
    if (a === 'spineTop' && b === 'neck') return sh * 0.28; // 首
    if (a === 'shoulderL' && b === 'shoulderR') return sh * 0.35;
    if (a === 'hipL' && b === 'hipR') return sh * 0.6;
    if (a.startsWith('shoulder')) return sh * 0.3; // 上腕
    if (a.startsWith('elbow')) return sh * 0.24; // 前腕
    if (a.startsWith('hip')) return sh * 0.42; // もも
    if (a.startsWith('knee')) return sh * 0.32; // すね
    return sh * 0.3;
  }

  function svgPoint(svg, ev) {
    const r = svg.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * VIEW_W,
      y: ((ev.clientY - r.top) / r.height) * VIEW_H,
    };
  }

  function startDrag(ev, id, view) {
    ev.preventDefault();
    ev.stopPropagation();
    const svg = svgs[view];
    const pointerId = ev.pointerId;
    try { ev.currentTarget.setPointerCapture(pointerId); } catch { /* window監視で継続 */ }
    opts.onStatus?.(`「${JOINT_LABELS[id]}」を動かしています(骨の長さは変わりません。他の面も連動します)`);
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      joints = dragJoint(joints, lengths, id, fromPx(svgPoint(svg, e), view), view);
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

  function reset() {
    joints = rest;
    redraw();
    opts.onPoseChange?.(joints, false);
  }

  mount();
  return {
    reset,
    getJoints: () => joints,
    isPosed: () => isPosed(joints, rest),
    setFlesh(on) {
      for (const svg of Object.values(svgs)) svg.classList.toggle('with-flesh', !!on);
    },
  };
}
