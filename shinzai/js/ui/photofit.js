// js/ui/photofit.js — 画像から骨格: テンプレート骨格を画像に重ね、関節をドラッグで合わせる
// 座標→比率の変換は js/core/skeleton2d.js(ピュア)に委譲し、ここはドラッグUIのみ。
// 画像は端末内でのみ扱い、外部送信・保存はしない(不変条件)。

import { PROPORTION_PRESETS } from '../core/proportions.js';
import { detectFigureBox } from '../core/imagefit.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// テンプレート骨格の初期配置(x=中心からのオフセット, y=図の全高に対する割合)
function templateJoints(ratios) {
  const half = ratios.shoulderWidth / 2;
  const hipHalf = half * 0.7;
  const shoulderY = ratios.head * 1.15;
  const elbowY = shoulderY + ratios.upperArm;
  const wristY = elbowY + ratios.forearm;
  const kneeY = ratios.hipTop + ratios.thigh;
  const ankleY = kneeY + ratios.shin;
  return {
    top: { x: 0, y: 0 },
    chin: { x: 0, y: ratios.head },
    shoulderL: { x: -half, y: shoulderY },
    shoulderR: { x: half, y: shoulderY },
    elbowL: { x: -half - 0.02, y: elbowY },
    elbowR: { x: half + 0.02, y: elbowY },
    wristL: { x: -half - 0.035, y: wristY },
    wristR: { x: half + 0.035, y: wristY },
    hip: { x: 0, y: ratios.hipTop },
    kneeL: { x: -hipHalf, y: kneeY },
    kneeR: { x: hipHalf, y: kneeY },
    ankleL: { x: -hipHalf, y: ankleY },
    ankleR: { x: hipHalf, y: ankleY },
    sole: { x: 0, y: 1 },
  };
}

const BONES = [
  ['top', 'chin'], ['chin', 'hip'],
  ['shoulderL', 'shoulderR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hip', 'kneeL'], ['kneeL', 'ankleL'],
  ['hip', 'kneeR'], ['kneeR', 'ankleR'],
];

const JOINT_LABELS = {
  top: '頭頂', chin: 'あご', shoulderL: '肩', shoulderR: '肩',
  elbowL: 'ヒジ', elbowR: 'ヒジ', wristL: '手首', wristR: '手首',
  hip: '股', kneeL: 'ヒザ', kneeR: 'ヒザ', ankleL: 'くるぶし', ankleR: 'くるぶし',
  sole: '足裏',
};

// container: 画像+SVGオーバーレイを入れる要素 / onChange: 関節が動くたび joints(px) を通知
export function createPhotoFit(container, onChange) {
  let joints = null; // {id: {x,y}} px(表示座標)
  let svg = null;

  function emit() {
    if (joints) onChange({ ...joints });
  }

  function layoutTemplate(width, height, box = null) {
    const base = PROPORTION_PRESETS['female-adult'].ratios;
    const tpl = templateJoints(base);
    const figTop = box ? box.figTop : height * 0.06;
    const figH = box ? box.figH : height * 0.88;
    const cx = box ? box.cx : width / 2;
    joints = {};
    for (const [id, p] of Object.entries(tpl)) {
      joints[id] = { x: cx + p.x * figH, y: figTop + p.y * figH };
    }
  }

  // 前景検出でテンプレートの初期位置を画像内の人物に合わせる(失敗時は null → 既定配置)
  function detectBox(img, w, h) {
    try {
      const sw = 160;
      const sh = Math.max(1, Math.round((sw * img.naturalHeight) / img.naturalWidth));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, sw, sh);
      const box = detectFigureBox(ctx.getImageData(0, 0, sw, sh));
      if (!box.found) return null;
      return {
        figTop: (box.top / sh) * h,
        figH: ((box.bottom - box.top) / sh) * h,
        cx: (box.centerX / sw) * w,
      };
    } catch {
      return null;
    }
  }

  function redrawBones() {
    for (const line of svg.querySelectorAll('line[data-bone]')) {
      const [a, b] = line.dataset.bone.split('-');
      line.setAttribute('x1', joints[a].x);
      line.setAttribute('y1', joints[a].y);
      line.setAttribute('x2', joints[b].x);
      line.setAttribute('y2', joints[b].y);
    }
    for (const c of svg.querySelectorAll('circle[data-joint]')) {
      const p = joints[c.dataset.joint];
      c.setAttribute('cx', p.x);
      c.setAttribute('cy', p.y);
    }
  }

  function buildOverlay(width, height) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'photofit-overlay');
    for (const [a, b] of BONES) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.dataset.bone = `${a}-${b}`;
      svg.append(line);
    }
    for (const id of Object.keys(joints)) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.dataset.joint = id;
      c.setAttribute('r', 9);
      c.append(titleEl(JOINT_LABELS[id]));
      c.addEventListener('pointerdown', (ev) => startDrag(ev, id));
      svg.append(c);
    }
    redrawBones();
    return svg;
  }

  function titleEl(text) {
    const t = document.createElementNS(SVG_NS, 'title');
    t.textContent = text;
    return t;
  }

  function svgPoint(ev) {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return {
      x: Math.min(vb.width, Math.max(0, ((ev.clientX - rect.left) / rect.width) * vb.width)),
      y: Math.min(vb.height, Math.max(0, ((ev.clientY - rect.top) / rect.height) * vb.height)),
    };
  }

  function startDrag(ev, id) {
    ev.preventDefault();
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    const move = (e) => {
      joints[id] = svgPoint(e);
      redrawBones();
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      emit();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  // dataUrl の画像を表示してテンプレート骨格を重ねる
  function loadImage(dataUrl) {
    return new Promise((resolvePromise, rejectPromise) => {
      const img = new Image();
      img.onload = () => {
        container.replaceChildren();
        // 表示幅に合わせた座標系(横長すぎ・縦長すぎでも破綻しないよう長辺基準)
        const maxW = container.clientWidth || 360;
        const scale = maxW / img.naturalWidth;
        const w = maxW;
        const h = img.naturalHeight * scale;
        img.className = 'photofit-image';
        container.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        container.append(img);
        layoutTemplate(w, h, detectBox(img, w, h));
        container.append(buildOverlay(w, h));
        emit();
        resolvePromise();
      };
      img.onerror = () => rejectPromise(new Error('画像を読み込めませんでした'));
      img.src = dataUrl;
    });
  }

  return { loadImage, getJoints: () => (joints ? { ...joints } : null) };
}
