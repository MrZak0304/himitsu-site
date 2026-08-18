// js/app.js — UI配線のみ。計算ロジックは js/core/ に置き、ここには書かない。
import { computeArmature, SCALE_CHOICES } from './core/armature.js';
import { PROPORTION_PRESETS } from './core/proportions.js';
import {
  applyAdjustments, ADJUSTMENT_DEFS, DEFAULT_ADJUSTMENTS, isAdjusted,
} from './core/adjustments.js';
import { ratiosFromJoints } from './core/skeleton2d.js';
import { detectFigureBox, detectHead } from './core/imagefit.js';
import { VIEW_W as VIEW_W_PX, VIEW_H as VIEW_H_PX } from './ui/diagram.js';
import {
  loadPresets, savePreset, deletePreset, hasPreset, STORE_KEY,
} from './core/presets-store.js';
import { createPoseFigure } from './ui/posefig.js';
import { DRAGGABLE as POSE_JOINTS, JOINT_LABELS as POSE_LABELS, restPose, poseFromFit } from './core/pose3d.js';
import { buildObj } from './core/export3d.js';
import { MATERIALS, materialUrl } from './affiliates.js';
import { IS_FREE, LIMITS, VARIANT_LABEL } from './build-flags.js';

const $ = (id) => document.getElementById(id);
const storage = window.localStorage;
let adjustments = { ...DEFAULT_ADJUSTMENTS };
let showFlesh = false; // 肉付けイメージの表示(両タブ共通)
const poseStates = new WeakMap(); // 出力領域ごとのポーズ状態(計算タブ/画像からタブで独立)
// 参考画像(キャラクターの設定で選ぶ。芯材計算タブの正面図の背面に表示。第18〜19弾FB)
const refImage = { overlay: null, dragTarget: 'view', hidden: false, faceGuide: false, marks: null };
// 参考画像から取り込んだ体型(比率セット)。null ならプリセット(第2段階=一体化)
let importedRatios = null;
// 骨格合わせ(体型合わせ)モード。キャラクターの設定から操作(第23弾FB)。芯材計算タブのみ
const fitState = { on: false, joints: null, locked: false };
const uiAids = { axisLock: false, mirror: false, big: false, fitFree: false };
// 骨格ページの表示(第58弾FB UI改修): viewMode=正面/左側面/右側面/三面、menuSide=サイドメニューの位置(設定)
const uiLayout = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('shinzaiMaker.ui') || '{}') || {}; } catch { /* ignore */ }
  return {
    viewMode: saved.viewMode ?? 'front',
    menuSide: saved.menuSide ?? 'right',
    gizmoSpeed: Number.isFinite(saved.gizmoSpeed) ? saved.gizmoSpeed : 1.2, // 3Dの回転の速さ(度/px。第68弾FB)
    section: 'frame',
  };
})();
function saveUiLayout() { try { localStorage.setItem('shinzaiMaker.ui', JSON.stringify({ viewMode: uiLayout.viewMode, menuSide: uiLayout.menuSide, gizmoSpeed: uiLayout.gizmoSpeed })); } catch { /* ignore */ } }
// 肉付けのボリューム(キャラクターごと。保存データに含める。第52弾FB)
const BUST_SHAPES = [
  { key: 'bowl', label: 'おわん型' },
  { key: 'plate', label: 'さら型' },
  { key: 'pyramid', label: 'ピラミッド型' },
  { key: 'hemi', label: '半球型' },
  { key: 'goat', label: 'ヤギ型' },
  { key: 'cone', label: '円錐型' },
];
const VOLUME_DEFS = [
  { key: 'body', label: '肉付き', min: 0, max: 2, step: 0.05, def: 1, fmt: (v) => (v < 0.75 ? '細め' : v > 1.25 ? 'ふくよか' : '標準') },
  { key: 'muscle', label: '筋肉', min: 0, max: 2, step: 0.05, def: 0, fmt: (v) => (v < 0.5 ? '標準' : v < 1.5 ? '多め' : 'かなり') },
  { key: 'bust', label: 'バスト', min: 0, max: 2, step: 0.01, def: 0.35, fmt: (v) => (v < 0.05 ? 'なし' : v < 0.35 ? '小' : v < 0.7 ? '中' : v < 1.2 ? '大' : '特大') },
];
const DEFAULT_VOLUME = { ...Object.fromEntries(VOLUME_DEFS.map((d) => [d.key, d.def])), bustShape: 'bowl' };
let fleshVolume = { ...DEFAULT_VOLUME }; // 操作の補助(まっすぐ動かす・大きく表示)。第33弾FB
// 肉付けの色・透け具合(第38弾FB)。端末内に保存
const FLESH_COLORS = [
  { key: 'skin', label: '肌色', value: '#e6c9a5' },
  { key: 'gray', label: 'グレー', value: '#9a9a9a' },
  { key: 'blue', label: '青', value: '#6f9fd8' },
  { key: 'green', label: '緑', value: '#7fb77e' },
  { key: 'red', label: '赤', value: '#d97a7a' },
];
const fleshStyle = (() => {
  try { const j = JSON.parse(localStorage.getItem('shinzaiMaker.flesh') || 'null'); if (j && typeof j === 'object') return { color: j.color || '#e6c9a5', opacity: Number.isFinite(j.opacity) ? j.opacity : 0.65 }; } catch { /* ignore */ }
  return { color: '#e6c9a5', opacity: 0.65 };
})();
function saveFleshStyle() { try { localStorage.setItem('shinzaiMaker.flesh', JSON.stringify(fleshStyle)); } catch { /* ignore */ } }
function applyFleshStyle() {
  for (const v of document.querySelectorAll('.views')) {
    v.style.setProperty('--flesh', fleshStyle.color);
    v.style.setProperty('--flesh-op', String(fleshStyle.opacity));
  }
}

// ---- タブ ----

function showTab(name) {
  for (const section of document.querySelectorAll('main .tab')) {
    section.hidden = uiLayout.allTabs ? false : section.dataset.tab !== name;
  }
  document.body.classList.toggle('in-make', name === 'make');
  for (const btn of document.querySelectorAll('.tabbar button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  }
  if (name === 'save') renderPresetList();
  if (name === 'make') applyViewMode();
}
// 骨組み作成タブ内のステップ(キャラ設定 → 骨格 → 仕上がり)。下部タブは増やさない(第59弾FB)
function showStep(name) {
  uiLayout.step = name;
  showTab('make');
  for (const st of document.querySelectorAll('.tab[data-tab=make] .step')) st.hidden = uiLayout.allSteps ? false : st.dataset.step !== name;
  for (const b of document.querySelectorAll('.stepbar button')) b.setAttribute('aria-current', b.dataset.step === name ? 'step' : 'false');
  document.body.classList.toggle('step-skel', name === 'skel'); // 作成画面はスクロール不要にコンパクト表示
  document.body.classList.toggle('in-make', true); // 骨組み作成タブではヘッダーを出さない(第61弾FB)
  if (name === 'skel') applyViewMode();
  window.scrollTo(0, 0);
}
// 骨格ページ: メイン図の切り替え(正面/左側面/右側面/三面/3D。3Dは第65弾FB)
const VIEW_ORDER = ['front', 'side-left', 'side-right', 'turn'];
function applyViewMode() {
  const mode = uiLayout.viewMode;
  for (const b of document.querySelectorAll('#viewSwitch button[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  $('turnCtl').hidden = mode !== 'turn'; // 3Dのときだけ視点を回すボタンを出す
  const views = document.querySelector('#calcOutput .views');
  if (!views) return;
  views.classList.toggle('single', mode !== 'all');
  // 「三面」は正面・左側面・右側面の3枚(3Dは含めない)
  views.querySelectorAll('.view').forEach((v, i) => v.classList.toggle('active', mode === 'all' ? VIEW_ORDER[i] !== 'turn' : VIEW_ORDER[i] === mode));
}
// XYZ の向きギズモ(視点切替レール)。軸を押すとその面から見る(第66弾FB)
const GIZMO_AXES = [
  ['x', 'X', { yaw: 90, pitch: 0 }],   // 横 → 右から
  ['y', 'Y', { yaw: 0, pitch: 70 }],   // 上 → 上から
  ['z', 'Z', { yaw: 0, pitch: 0 }],    // 前 → 正面から
];
const GIZ = { c: 32, len: 20 };
function buildGizmo() {
  const svg = $('turnGizmo');
  if (svg.childElementCount) return;
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  svg.append(mk('circle', { class: 'giz-base', cx: GIZ.c, cy: GIZ.c, r: GIZ.len + 10 }));
  for (const [key, label, snap] of GIZMO_AXES) {
    svg.append(mk('line', { class: `giz-axis giz-${key}`, 'data-axis': key, x1: GIZ.c, y1: GIZ.c, x2: GIZ.c, y2: GIZ.c }));
    const t = mk('text', { class: `giz-label giz-${key}`, 'data-axis': key, 'text-anchor': 'middle', 'dominant-baseline': 'central', x: GIZ.c, y: GIZ.c });
    t.textContent = label;
    const hit = mk('circle', { class: 'giz-hit', 'data-axis': key, r: 12, cx: GIZ.c, cy: GIZ.c });
    const title = mk('title', {}); title.textContent = `${label}軸から見る`;
    hit.append(title);
    hit.addEventListener('click', () => { if (!gizmoDragged) turnView({ ...snap, absolute: true }); });
    svg.append(t, hit);
  }
  bindGizmoDrag(svg);
}
// ギズモを直接ドラッグして視点を回す(第67弾FB)。横=左右に回す・縦=見上げ/見下ろし
let gizmoDragged = false;
function bindGizmoDrag(svg) {
  let start = null;
  const move = (ev) => {
    if (!start) return;
    ev.preventDefault();
    const k = uiLayout.gizmoSpeed; // 設定で変えられる(度/px)
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) gizmoDragged = true;
    turnView({ yaw: start.yaw + dx * k, pitch: start.pitch + dy * k, absolute: true });
  };
  const up = () => {
    start = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    setTimeout(() => { gizmoDragged = false; }, 0); // クリック(軸で正面に切替)と区別する
  };
  svg.addEventListener('pointerdown', (ev) => {
    const fig = poseStates.get($('calcOutput'))?.fig;
    if (!fig) return;
    ev.preventDefault();
    gizmoDragged = false;
    start = { x: ev.clientX, y: ev.clientY, yaw: fig.getYaw(), pitch: fig.getPitch() };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
function drawGizmo(info) {
  const svg = $('turnGizmo');
  if (!svg.childElementCount || !info) return;
  for (const [key] of GIZMO_AXES) {
    const p = info.axes[key];
    const end = { x: GIZ.c + p.u * GIZ.len, y: GIZ.c + p.v * GIZ.len };
    const lab = { x: GIZ.c + p.u * (GIZ.len + 8), y: GIZ.c + p.v * (GIZ.len + 8) };
    const op = (0.4 + 0.6 * Math.hypot(p.u, p.v)).toFixed(2);
    const line = svg.querySelector(`line.giz-${key}`);
    line.setAttribute('x2', end.x.toFixed(1)); line.setAttribute('y2', end.y.toFixed(1)); line.setAttribute('opacity', op);
    const txt = svg.querySelector(`text.giz-${key}`);
    txt.setAttribute('x', lab.x.toFixed(1)); txt.setAttribute('y', lab.y.toFixed(1)); txt.setAttribute('opacity', op);
    const hit = svg.querySelector(`circle.giz-hit[data-axis=${key}]`);
    hit.setAttribute('cx', lab.x.toFixed(1)); hit.setAttribute('cy', lab.y.toFixed(1));
  }
  $('turnPlane').textContent = info.plane;
}

// 3Dの視点(左右に回す=yaw / 見上げ・見下ろし=pitch)。図を作り直しても保つ
function syncTurnLabel(fig) {
  const st = poseStates.get($('calcOutput'));
  if (st) { st.yaw = fig.getYaw(); st.pitch = fig.getPitch(); }
  $('turnAngle').textContent = `${Math.round(fig.getYaw())}°/${Math.round(fig.getPitch())}°`;
  drawGizmo(fig.turnInfo());
}
function turnView({ yaw = 0, pitch = 0, absolute = false } = {}) {
  const fig = poseStates.get($('calcOutput'))?.fig;
  if (!fig) return;
  fig.setYaw(absolute ? yaw : fig.getYaw() + yaw);
  fig.setPitch(absolute ? pitch : fig.getPitch() + pitch);
  syncTurnLabel(fig);
}
// サイドメニュー(骨格ページ): レールのボタンで区分を開閉
function openSection(sec, toggle = true) {
  const panel = $('sidePanel');
  const same = uiLayout.section === sec && !panel.hidden;
  if (toggle && same) { panel.hidden = true; }
  else { uiLayout.section = sec; panel.hidden = false; }
  for (const b of document.querySelectorAll('#sideRail button[data-sec]')) b.setAttribute('aria-pressed', String(!panel.hidden && b.dataset.sec === uiLayout.section));
  for (const sc of document.querySelectorAll('#sidePanel .side-sec')) sc.hidden = uiLayout.allSections ? false : sc.dataset.sec !== uiLayout.section;
  document.body.classList.toggle('side-open', !panel.hidden);
  poseStates.get($('calcOutput'))?.fig?.setDetectMarks(refMarksVisible() ? refImage.marks : null);
  // 参考画像の区分から離れたら画像は動かないようにする(第66弾FB)
  if ((panel.hidden || uiLayout.section !== 'ref') && refImage.dragTarget === 'overlay') {
    refImage.dragTarget = 'view';
    refImage.faceGuide = false;
    poseStates.get($('calcOutput'))?.fig?.setDragTarget('view');
    syncRefButtons();
    renderCalc();
  }
  scheduleFigureHeight();
}
// 認識の目印(顔・足元)は参考画像の区分を開いているあいだだけ出す
function refMarksVisible() {
  return !!refImage.marks && !$('sidePanel').hidden && uiLayout.section === 'ref';
}
function applyMenuSide() {
  $('skelLayout').classList.toggle('side-left', uiLayout.menuSide === 'left');
  document.body.classList.toggle('menu-left', uiLayout.menuSide === 'left');
}
// 開いたメニューが下部タブに重ならないよう、実測の高さ(セーフエリア込み)をCSS変数に渡す(第63弾FB)
function syncTabbarHeight() {
  const bar = document.querySelector('.tabbar');
  if (bar?.offsetHeight) document.documentElement.style.setProperty('--tabbar-h', `${bar.offsetHeight}px`);
}
// メニュー(シート)を開いている間、図がシートに隠れないように高さを実測で決める(第63弾FB)。
// 図の上の案内文の行数でずれるため、CSSの目安値ではなく実際の余白から求める。
function syncFigureHeight() {
  const root = document.documentElement;
  const svg = document.querySelector('#calcOutput .views .view.active svg.pose-svg')
    ?? document.querySelector('#calcOutput .views svg.pose-svg');
  const panel = $('sidePanel');
  if (!svg || !panel || panel.hidden || window.innerWidth >= 900) {
    root.style.removeProperty('--fig-open-h');
    return;
  }
  const top = svg.getBoundingClientRect().top;
  const limit = panel.getBoundingClientRect().top - 6;
  root.style.setProperty('--fig-open-h', `${Math.max(180, Math.round(limit - top))}px`);
}
let figHeightRaf = 0;
function scheduleFigureHeight() {
  if (figHeightRaf) return;
  figHeightRaf = requestAnimationFrame(() => { figHeightRaf = 0; syncFigureHeight(); });
}

// ---- 共通の結果描画 ----

const SEGMENT_LABELS = [
  ['figureHeight', '全高(完成サイズ)'],
  ['head', '頭(頭頂〜あご)'],
  ['headTopToHip', '頭頂〜腰(股)'],
  ['hipToSole', '腰(股)〜足先'],
  ['shoulderWidth', '肩幅'],
  ['upperArm', '肩〜ヒジ'],
  ['forearm', 'ヒジ〜手首'],
  ['hand', '手'],
  ['thigh', 'もものつけ根〜ヒザ'],
  ['shin', 'ヒザ〜くるぶし'],
  ['footLength', '足(かかと〜つま先)'],
];

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// sides: 骨格ページのサイドメニュー各区分の入れ物 { frame, flesh, pose, sample }、tables: 仕上がりページの入れ物。
// 省略時はすべて root に入れる(旧レイアウト互換)
function renderResultInto(root, result, { showScale = true, sides = null, tables = null } = {}) {
  root.replaceChildren();
  root.hidden = false;
  const scalePart = showScale ? `${result.scaleLabel} スケール / ` : '';
  const summaryLine = `${scalePart}完成サイズ 約${result.figureHeightCm}cm / 推奨アルミ線径 ${result.wireDiameterMm}mm(2本撚り)`;
  root.append(h('p', 'summary', summaryLine));
  const S = {
    ref: sides?.ref ?? root,
    frame: sides?.frame ?? root, flesh: sides?.flesh ?? root, pose: sides?.pose ?? root, sample: sides?.sample ?? root,
  };
  for (const el0 of new Set([S.ref, S.frame, S.flesh, S.pose, S.sample])) if (el0 !== root) el0.replaceChildren();
  const tablesRoot = tables ?? root;
  if (tablesRoot !== root) { tablesRoot.replaceChildren(); tablesRoot.append(h('h2', null, '仕上がり'), h('p', 'summary', summaryLine)); }

  // 表示切り替え: 大きめのトグルボタン(チェックボックスは触りづらい→2026-08-15 PDフィードバック第12弾)
  const poseState = poseStates.get(root) ?? { on: false, joints: null, sig: null };
  poseStates.set(root, poseState);
  // 寸法(体型・サイズ)が変わったら保持していたポーズは捨てる(骨長が合わなくなるため)
  const sig = JSON.stringify(result.segments);
  if (poseState.sig !== sig) {
    poseState.joints = null;
    poseState.sig = sig;
  }
  const toggleRow = h('div', 'toggle-row');
  const fleshBtn = h('button', 'toggle flesh-toggle-btn', '肉付け');
  fleshBtn.type = 'button';
  fleshBtn.setAttribute('aria-pressed', String(showFlesh));
  const poseBtn = h('button', 'toggle pose-toggle-btn', 'ポーズを取る');
  poseBtn.type = 'button';
  poseBtn.setAttribute('aria-pressed', String(poseState.on));
  if (sides) { S.pose.append(poseBtn); toggleRow.append(); root.append(toggleRow); toggleRow.hidden = true; }
  else { toggleRow.append(fleshBtn, poseBtn); root.append(toggleRow); }
  // 肉付けの色・透け具合(肉付けONのときだけ表示)
  const fleshOpts = h('div', 'flesh-opts');
  fleshOpts.hidden = !showFlesh;
  const swatches = h('div', 'swatches');
  for (const c of FLESH_COLORS) {
    const b = h('button', 'swatch');
    b.type = 'button'; b.title = c.label; b.setAttribute('aria-label', `肉付けの色: ${c.label}`);
    b.style.background = c.value; b.dataset.color = c.value;
    b.setAttribute('aria-pressed', String(fleshStyle.color === c.value));
    b.addEventListener('click', () => {
      fleshStyle.color = c.value; saveFleshStyle(); applyFleshStyle();
      for (const x of swatches.querySelectorAll('.swatch')) x.setAttribute('aria-pressed', String(x.dataset.color === c.value));
    });
    swatches.append(b);
  }
  const opLabel = h('span', 'op-label', '透け具合');
  const opRange = document.createElement('input');
  opRange.type = 'range'; opRange.min = '20'; opRange.max = '100'; opRange.step = '5'; opRange.className = 'flesh-opacity';
  opRange.value = String(Math.round(fleshStyle.opacity * 100));
  opRange.setAttribute('aria-label', '肉付けの透け具合(不透明度%)');
  opRange.addEventListener('input', () => { fleshStyle.opacity = Number(opRange.value) / 100; applyFleshStyle(); });
  opRange.addEventListener('change', saveFleshStyle);
  fleshOpts.append(h('span', '', '肉付けの色'), swatches, opLabel, opRange);
  // ボリューム(肉付き・筋肉・バスト)
  const volRow = h('div', 'flesh-volume');
  for (const d of VOLUME_DEFS) {
    const lab = document.createElement('label');
    lab.append(h('span', '', d.label));
    const rng = document.createElement('input');
    rng.type = 'range'; rng.min = String(d.min); rng.max = String(d.max); rng.step = String(d.step);
    rng.className = `vol-${d.key}`;
    const v0 = Number.isFinite(fleshVolume[d.key]) ? fleshVolume[d.key] : d.def;
    rng.value = String(v0);
    const val = h('span', 'vol-val', d.fmt(v0));
    rng.setAttribute('aria-label', `肉付けの${d.label}`);
    // スライダー中は描画だけ更新(関節位置はそのまま)。入力ごとに再生成すると重いので rAF でまとめる
    let raf = 0;
    rng.addEventListener('input', () => {
      fleshVolume[d.key] = Number(rng.value);
      val.textContent = d.fmt(fleshVolume[d.key]);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderViews(); });
    });
    lab.append(rng, val);
    volRow.append(lab);
  }
  // バストの形状(第55弾FB: おわん/さら/ピラミッド/半球/ヤギ/円錐)
  const shapeRow = h('div', 'bust-shapes');
  shapeRow.append(h('span', '', '形状'));
  for (const bs of BUST_SHAPES) {
    const b = h('button', 'chip bust-shape', bs.label);
    b.type = 'button'; b.dataset.shape = bs.key;
    b.setAttribute('aria-pressed', String((fleshVolume.bustShape ?? 'bowl') === bs.key));
    b.addEventListener('click', () => {
      fleshVolume.bustShape = bs.key;
      for (const x of shapeRow.querySelectorAll('.bust-shape')) x.setAttribute('aria-pressed', String(x.dataset.shape === bs.key));
      renderViews();
    });
    shapeRow.append(b);
  }
  // 男性ではバストの形状は選べない(第66弾FB)
  shapeRow.hidden = $('preset').value === 'male-adult';
  volRow.append(shapeRow);
  fleshOpts.append(volRow);
  if (sides) {
    // 肉付け設定: 設定項目を上、「肉付け」ボタンを下に(第62弾FB)。設定は肉付けOFFでも触れるように常に表示
    fleshOpts.hidden = false;
    S.flesh.append(fleshOpts, fleshBtn);
  } else {
    S.flesh.append(fleshOpts);
  }

  // ポーズ操作(図の上に置く: スマホで三面図の下だと遠い)
  const poseTools = h('div', 'pose-tools');
  const poseHint = h('p', 'hint pose-hint');
  const resetAll = h('button', 'ghost', '全体を初期位置に戻す');
  resetAll.type = 'button';
  // 戻す関節はセレクトで選べる(直前に触った関節が自動で選ばれる。第13弾FB)
  const jointSel = document.createElement('select');
  jointSel.className = 'joint-select';
  jointSel.setAttribute('aria-label', '初期位置に戻す関節');
  for (const id of POSE_JOINTS) jointSel.append(new Option(POSE_LABELS[id], id));
  const resetOne = h('button', 'ghost', 'この関節を戻す');
  resetOne.type = 'button';
  const oneRow = h('div', 'pose-one-row');
  oneRow.append(jointSel, resetOne);
  const poseButtons = h('div', 'pose-buttons');
  poseButtons.append(oneRow, resetAll);
  // 表示位置・倍率(ポーズではみ出したときに見やすく調整。背景ドラッグ=移動、2本指=拡大縮小)
  const viewRow = h('div', 'view-buttons');
  const mkBtn = (label, cls) => { const b = h('button', `ghost ${cls}`, label); b.type = 'button'; return b; };
  const fitBtn = mkBtn('全体を収める', 'view-fit');
  const zoomInBtn = mkBtn('拡大', 'view-zoom-in');
  const zoomOutBtn = mkBtn('縮小', 'view-zoom-out');
  const viewResetBtn = mkBtn('表示位置を戻す', 'view-reset');
  viewRow.append(fitBtn, zoomInBtn, zoomOutBtn, viewResetBtn);
  // 操作の補助: まっすぐ動かす(縦横ロック)・大きく表示(第33弾FB)
  const aidRow = h('div', 'aid-buttons');
  const axisBtn = h('button', 'toggle axis-lock-btn', 'まっすぐ動かす');
  axisBtn.type = 'button'; axisBtn.setAttribute('aria-pressed', String(uiAids.axisLock));
  const bigBtn = h('button', 'toggle big-view-btn', '大きく表示');
  bigBtn.type = 'button'; bigBtn.setAttribute('aria-pressed', String(uiAids.big));
  const mirrorBtn = h('button', 'toggle mirror-btn', '対称移動');
  mirrorBtn.type = 'button'; mirrorBtn.setAttribute('aria-pressed', String(uiAids.mirror));
  aidRow.append(axisBtn, mirrorBtn, bigBtn);
  // 詳しい説明は折りたたみ(縦長対策。第27弾FB)
  const help = document.createElement('details');
  help.className = 'pose-help';
  const helpSum = document.createElement('summary');
  helpSum.textContent = '操作のヒント';
  help.append(helpSum, h('p', 'hint', '図の移動・拡大縮小は2本指(1本指の背景ドラッグでは動きません。「参考画像を動かす」中は画像が動きます)。関節を離したとき枠外なら自動で全体を収めます。「全体を初期位置に戻す」はポーズ・ひねり・表示位置を初期化します。骨格調整中はひねり・関節リセットは使えません(骨の長さを変えるモードのため)。'));
  const viewHint = help;
  // ひねり(第15〜16弾FB): 上半身(肩)=首のつけ根から先 / 腰(骨盤)=股関節から先 を背骨の軸まわりに回す
  const mkTwist = (key, label, cls) => {
    const row = h('div', 'twist-row');
    const lab = h('label', null, label);
    lab.htmlFor = `${cls}-${root.id}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `${cls}-${root.id}`;
    input.className = `twist-range ${cls}`;
    input.min = '-90'; input.max = '90'; input.step = '1';
    input.value = String(poseState[key] ?? 0);
    const val = h('span', 'adj-value', `${poseState[key] ?? 0}°`);
    const zero = h('button', 'ghost twist-zero', '0°に戻す');
    zero.type = 'button';
    row.append(lab, input, val, zero);
    return { row, input, val, zero };
  };
  const twistUp = mkTwist('twistUpper', '上半身(肩)のひねり', 'twist-upper');
  const twistLo = mkTwist('twistLower', '腰(骨盤)のひねり', 'twist-lower');
  const fitNote = h('p', 'hint fit-note', '');
  fitNote.hidden = true;
  // ポーズ中は骨長固定で位置合わせができない → 骨格合わせ(ロック済み)へのショートカット(第28弾FB)
  const toFitBtn = h('button', 'ghost to-fit-btn', '骨格を調整する');
  toFitBtn.type = 'button';
  const toFitRow = h('div', 'to-fit-row');
  toFitRow.append(toFitBtn);
  // 骨格調整の終了操作(骨組み調整の区分)。位置ロックは「参考画像」の区分へ移動(第65弾FB)
  const fitDoneBtn = h('button', 'fit-done-btn', '取り込んで終える');
  fitDoneBtn.type = 'button';
  const fitCancelBtn = h('button', 'ghost fit-cancel-btn', '取り込まずに終える');
  fitCancelBtn.type = 'button';
  // 腕・脚の関節は既定で「回す(持ち上げる)」。長さを変えるときだけON(第45弾FB「腕が伸びる」→ 第65弾FBで「骨格の伸縮」に改名)
  const fitFreeBtn = h('button', 'toggle fit-free-btn', '骨格の伸縮');
  fitFreeBtn.type = 'button';
  // 左右対称に動かすスイッチは骨組み調整にも置く(第65弾FB)。ポーズ設定側と同じ状態を共有
  const mirrorBtn2 = h('button', 'toggle mirror-btn2', '対称移動');
  mirrorBtn2.type = 'button'; mirrorBtn2.setAttribute('aria-pressed', String(uiAids.mirror));
  const fitActions = h('div', 'fit-actions');
  fitActions.append(fitDoneBtn, fitCancelBtn, fitFreeBtn, mirrorBtn2);
  fitActions.hidden = true;
  const fitDone = h('p', 'hint fit-done-msg', '');
  fitDone.hidden = true;
  if (sides) {
    // 図の上: 案内だけ。骨組み調整: 取り込み/終了/ロック/長さ・ポーズ中の「骨格を調整する」。ポーズ設定: ひねり/リセット/表示/補助/ヒント
    poseTools.append(poseHint, fitNote);
    S.ref.append(fitActions); S.frame.append(toFitRow);
    const poseGroup = h('div', 'pose-group');
    poseGroup.append(twistUp.row, twistLo.row, poseButtons, viewRow, aidRow, viewHint);
    S.pose.append(poseGroup);
    poseTools.dataset.poseGroup = '1';
    poseTools._poseGroup = poseGroup;
  } else {
    poseTools.append(poseHint, fitNote, fitActions, toFitRow, twistUp.row, twistLo.row, poseButtons, viewRow, aidRow, viewHint);
  }
  root.append(poseTools);

  const views = h('div', 'views');
  root.append(views);

  const GUIDE_IDLE = '関節をドラッグでポーズ。股で全体移動。';
  const GUIDE_POSED = 'ポーズ中(骨の長さは不変。切り出し寸法はそのまま)。';
  const renderViews = () => {
    const isCalc = root.id === 'calcOutput';
    const fitOn = isCalc && fitState.on;
    const fig = createPoseFigure(views, result.segments, {
      flesh: showFlesh,
      interactive: poseState.on || fitOn,
      mode: fitOn ? 'fit' : 'pose',
      fitLocked: fitOn && fitState.locked,
      initialJoints: (() => {
        if (fitOn) return fitState.joints;
        if (root.id === 'calcOutput' && pendingFitPose) {
          // 取り込み直後: 合わせた関節の向きを保ったまま新しい骨長でポーズを組む(参考画像とズレない)
          poseState.joints = poseFromFit(restPose(result.segments), pendingFitPose);
          pendingFitPose = null;
        }
        return poseState.on ? poseState.joints : null;
      })(),
      // 触った関節名などの状態表示は骨格調整中だけ(ポーズ中は図の上に文字を出さない。第64弾FB)
      onStatus: (t) => { if (!sides) poseHint.textContent = t; },
      onJointPick: (id) => { if ([...jointSel.options].some((o) => o.value === id)) jointSel.value = id; },
      viewport: poseState.on ? poseState.viewport : null,
      axisLock: uiAids.axisLock,
      mirror: uiAids.mirror,
      fitFree: uiAids.fitFree,
      volume: fleshVolume,
      yaw: poseState.yaw ?? 30, // 3Dの視点(第65弾FB)
      pitch: poseState.pitch ?? 0, // 見上げ・見下ろし(第66弾FB)
      onTurnDraw: (info) => { if (isCalc) drawGizmo(info); }, // XYZの向き表示(視点切替レール)
      // 単面表示では自動で大きく(はみ出す分は切る slice)。三面では「大きく表示」トグルに従う(第61弾FB: 図をできるだけ大きく)
      big: uiAids.big || (sides && uiLayout.viewMode !== 'all'),
      onViewportChange: (vp) => { poseState.viewport = vp; },
      // 参考画像は芯材計算タブ(キャラクターの設定)の正面図にだけ表示。ポーズON/OFFに関わらず出す
      overlay: root.id === 'calcOutput' ? refImage.overlay : null,
      faceGuide: root.id === 'calcOutput' && refImage.faceGuide, // 顔合わせ中は頭の丸を強調(第66弾FB)
      detectMarks: root.id === 'calcOutput' && refMarksVisible() ? refImage.marks : null, // 顔・足元の認識結果(第68弾FB)
      dragTarget: root.id === 'calcOutput' ? refImage.dragTarget : 'view',
      onOverlayChange: (ov) => { if (root.id === 'calcOutput') { refImage.overlay = ov; syncRefButtons(); } },
      onPoseChange: (joints, posed) => {
        if (fitOn) { fitState.joints = posed ? joints : null; return; }
        poseState.joints = posed ? joints : null;
        if (!sides) poseHint.textContent = posed ? GUIDE_POSED : GUIDE_IDLE;
      },
    });
    poseState.fig = fig;
    if (isCalc) { scheduleFigureHeight(); syncTurnLabel(fig); }
    poseTools.hidden = !(poseState.on || fitOn);
    if (poseTools._poseGroup) poseTools._poseGroup.hidden = !(poseState.on || fitOn);
    if (sides) applyViewMode();
    // 骨格合わせ中はポーズ専用の操作(ひねり・関節リセット・ポーズ切替)を隠し、表示位置の操作だけ残す
    // 骨格合わせ中はひねり・関節リセットを無効表示(隠すと「消えた」と見えるため。第27弾FB)
    for (const n of [twistUp.row, twistLo.row, poseButtons]) n.classList.toggle('is-disabled', fitOn);
    for (const el2 of [twistUp.input, twistUp.zero, twistLo.input, twistLo.zero, resetOne, resetAll, jointSel]) el2.disabled = fitOn;
    fitNote.hidden = true; // 文字量削減(第47弾FB): 無効表示で伝わるので注記は出さない
    fitActions.hidden = !fitOn;
    fitFreeBtn.setAttribute('aria-pressed', String(uiAids.fitFree));
    mirrorBtn2.setAttribute('aria-pressed', String(uiAids.mirror));
    poseHint.classList.toggle('fit-banner', fitOn);
    toFitRow.hidden = sides ? true : !(isCalc && !fitOn); // サイドメニューでは「骨格を調整する」ボタンが同区分にあるので不要
    // 位置ロック中は表示位置の操作も隠す(関節以外は動かさない)
    // 位置ロック中でも拡大/縮小/収めるは使える(図と画像が一緒に動くので位置関係は崩れない。第33弾FB「操作範囲を大きく」)。
    // 背景ドラッグ・2本指は引き続き無効(fitLocked)
    viewHint.hidden = fitOn && fitState.locked;
    views.classList.toggle('big', uiAids.big && (poseState.on || fitOn));
    poseBtn.disabled = fitOn;
    if (isCalc) toggleRow.hidden = false;
    // 図の上には文言を出さない(第67弾FB「画面が狭くなる」)。案内は各区分のパネル側に置く
    if (sides) poseHint.hidden = true;
    if (fitOn) {
      poseHint.textContent = (fitIntro ? `${fitIntro}` : '骨格調整中: ') + '点を画像に重ねたら「取り込んで終える」。';
      fitIntro = '';
    } else if (poseState.on && !sides) {
      poseHint.textContent = poseState.joints ? GUIDE_POSED : GUIDE_IDLE;
    }
  };
  fleshBtn.addEventListener('click', () => {
    showFlesh = !showFlesh;
    renderCalc();
  });
  toFitBtn.addEventListener('click', () => enterFit(true));
  mirrorBtn2.addEventListener('click', () => mirrorBtn.click());
  fitFreeBtn.addEventListener('click', () => {
    uiAids.fitFree = !uiAids.fitFree;
    fitFreeBtn.setAttribute('aria-pressed', String(uiAids.fitFree));
    poseState.fig?.setFitFree(uiAids.fitFree);
  });
  fitDoneBtn.addEventListener('click', () => importFit());
  fitCancelBtn.addEventListener('click', () => { if (fitState.on) $('fitToggle').click(); });
  // 骨格合わせに入る直前の一言は、合わせ中バナーに合流させる(バナーが2枚重ならないように)
  let fitIntro = (root.id === 'calcOutput' && fitState.on && fitFlash) ? fitFlash : '';
  if (fitIntro) fitFlash = '';
  if (root.id === 'calcOutput' && fitFlash) {
    fitDone.textContent = fitFlash;
    fitDone.hidden = false;
    fitFlash = '';
    toggleRow.after(fitDone);
  }
  poseBtn.addEventListener('click', () => {
    poseState.on = !poseState.on;
    poseBtn.setAttribute('aria-pressed', String(poseState.on));
    renderViews();
  });
  resetAll.addEventListener('click', () => {
    poseState.fig?.reset();
    poseState.joints = null;
    for (const [key, t] of [['twistUpper', twistUp], ['twistLower', twistLo]]) {
      poseState[key] = 0;
      t.input.value = '0';
      t.val.textContent = '0°';
    }
  });
  const bindTwist = (key, t, apply) => t.input.addEventListener('input', () => {
    const next = Number(t.input.value);
    const delta = next - (poseState[key] ?? 0);
    poseState[key] = next;
    t.val.textContent = `${next}°`;
    apply(delta);
  });
  bindTwist('twistUpper', twistUp, (d) => poseState.fig?.twistUpper(d));
  bindTwist('twistLower', twistLo, (d) => poseState.fig?.twistLower(d));
  // 各ひねりの隣の「0°に戻す」(第17弾FB)
  for (const [key, t, apply] of [
    ['twistUpper', twistUp, (d) => poseState.fig?.twistUpper(d)],
    ['twistLower', twistLo, (d) => poseState.fig?.twistLower(d)],
  ]) {
    t.zero.addEventListener('click', () => {
      const cur = poseState[key] ?? 0;
      if (cur !== 0) apply(-cur);
      poseState[key] = 0;
      t.input.value = '0';
      t.val.textContent = '0°';
    });
  }
  resetOne.addEventListener('click', () => poseState.fig?.resetJoint(jointSel.value));
  fitBtn.addEventListener('click', () => poseState.fig?.fitAll());
  axisBtn.addEventListener('click', () => {
    uiAids.axisLock = !uiAids.axisLock;
    axisBtn.setAttribute('aria-pressed', String(uiAids.axisLock));
    poseState.fig?.setAxisLock(uiAids.axisLock);
  });
  mirrorBtn.addEventListener('click', () => {
    uiAids.mirror = !uiAids.mirror;
    for (const b of [mirrorBtn, mirrorBtn2]) b.setAttribute('aria-pressed', String(uiAids.mirror));
    poseState.fig?.setMirror(uiAids.mirror);
  });
  bigBtn.addEventListener('click', () => {
    uiAids.big = !uiAids.big;
    bigBtn.setAttribute('aria-pressed', String(uiAids.big));
    // 骨格合わせ中は関節位置を保って作り直す
    if (fitState.on && poseState.fig) fitState.joints = poseState.fig.getJoints();
    renderViews();
  });
  zoomInBtn.addEventListener('click', () => poseState.fig?.zoomIn());
  zoomOutBtn.addEventListener('click', () => poseState.fig?.zoomOut());
  viewResetBtn.addEventListener('click', () => poseState.fig?.resetView());
  renderViews();
  applyFleshStyle();

  tablesRoot.append(h('h3', null, '各部の仕上がり寸法'));
  const segTable = document.createElement('table');
  segTable.innerHTML = '<thead><tr><th>部位</th><th class="num">寸法</th></tr></thead>';
  const segBody = document.createElement('tbody');
  for (const [key, label] of SEGMENT_LABELS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td><td class="num">${result.segments[key]} cm</td>`;
    segBody.append(tr);
  }
  segTable.append(segBody);
  tablesRoot.append(segTable);

  tablesRoot.append(h('h3', null, 'アルミ線の切り出しリスト'));
  const cutHint = h('p', 'hint');
  cutHint.innerHTML = '「切り出し」はねじり(2本撚り)の縮みと接合ののりしろを見込んだ長さです。<strong>仕上がり寸法で切らないでください</strong>(短くて作り直しになります)。';
  tablesRoot.append(cutHint);
  const cutTable = document.createElement('table');
  cutTable.innerHTML = '<thead><tr><th>パーツ</th><th class="num">本数</th><th class="num">仕上がり</th><th class="num">切り出し</th></tr></thead>';
  const cutBody = document.createElement('tbody');
  for (const part of result.cutList) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${part.name}<div class="note">${part.note}</div></td>` +
      `<td class="num">${part.count}本</td>` +
      `<td class="num">${part.finishedCm} cm</td>` +
      `<td class="num"><strong>${part.cutCm} cm</strong></td>`;
    cutBody.append(tr);
  }
  cutTable.append(cutBody);
  tablesRoot.append(
    cutTable,
    h('p', 'summary', `切り出し合計: 約${result.totalCutCm}cm(ねじり・のりしろ込みの目安)`),
  );
  // 見本表示: 図の切り替え(単面/三面)と大きく表示、寸法注記の説明
  if (sides) {
    const sample = h('div', 'sample-opts');
    const bigBtn2 = h('button', 'toggle big-view-btn2', '大きく表示');
    bigBtn2.type = 'button'; bigBtn2.setAttribute('aria-pressed', String(uiAids.big));
    bigBtn2.addEventListener('click', () => bigBtn.click());
    sample.append(bigBtn2);
    sample.append(h('p', 'hint', '図の切り替えは図の上のボタン(正面/左側面/右側面/三面)。「三面」で見本の三面図(寸法注記付き)をまとめて確認できます。'));
    S.sample.append(sample);
  }
}

// ---- 芯材計算タブ ----

function fillSelects() {
  const presetSel = $('preset');
  for (const [key, preset] of Object.entries(PROPORTION_PRESETS)) {
    if (LIMITS.presetKeys && !LIMITS.presetKeys.includes(key)) continue;
    presetSel.append(new Option(preset.label, key));
  }
  const sel = $('scale');
  for (const d of SCALE_CHOICES) sel.append(new Option(`1/${d}`, String(d)));
  sel.value = '8';
}

// 「完成品のサイズから」/「設定の身長から」の選択(2026-08-14 PDフィードバック)
function sizeMode(groupName) {
  return document.querySelector(`input[name=${groupName}]:checked`)?.value ?? 'target';
}

function syncModeRows() {
  const calcByHeight = sizeMode('sizeMode') === 'height';
  $('targetHeightRow').hidden = calcByHeight;
  $('heightRow').hidden = !calcByHeight;
  $('scaleRow').hidden = !calcByHeight;
}

function activeCustomRatios() {
  const base = importedRatios ?? PROPORTION_PRESETS[$('preset').value].ratios;
  const adj = LIMITS.adjustments ? adjustments : {};
  if (!importedRatios && !isAdjusted(adj)) return null;
  return applyAdjustments(base, adj);
}

function syncImportedNote() {
  $('importedNote').hidden = !importedRatios;
}

function setImportedRatios(ratios) {
  importedRatios = ratios;
  syncImportedNote();
  buildAdjustSliders();
  renderCalc();
}

function readCalcInput() {
  const input = {
    preset: $('preset').value,
    customRatios: activeCustomRatios(),
  };
  if (sizeMode('sizeMode') === 'height') {
    input.modelHeightCm = Number($('height').value);
    input.scaleDenominator = Number($('scale').value);
  } else {
    const target = Number($('targetHeight').value);
    input.modelHeightCm = target;
    input.targetHeightCm = target;
  }
  return input;
}

function renderCalc() {
  const out = $('calcOutput');
  const errBox = $('calcError');
  errBox.hidden = true;
  try {
    const result = computeArmature(readCalcInput());
    // キャラクター設定ページ: 身長から指定のとき完成サイズを表示
    const byHeight = sizeMode('sizeMode') === 'height';
    $('finishedSizeRow').hidden = !byHeight;
    $('finishedSize').textContent = `約${result.figureHeightCm}cm(${result.scaleLabel})`;
    renderResultInto(out, result, {
      showScale: byHeight,
      sides: { ref: $('secRefFit'), frame: $('secFrame'), flesh: $('secFlesh'), pose: $('secPose'), sample: $('secSample') },
      tables: $('finishOutput'),
    });
  } catch (e) {
    out.hidden = true;
    errBox.hidden = false;
    errBox.textContent = e.message;
  }
}

// ---- 体型調整(マイ体型) ----

function buildAdjustSliders() {
  const box = $('adjustSliders');
  box.replaceChildren();
  const baseRatios = importedRatios ?? PROPORTION_PRESETS[$('preset').value].ratios;
  const format = (def, v) => (def.absolute ? `${Number(v).toFixed(1)}頭身` : `${Math.round(v * 100)}%`);
  // 頭身はキャラ設定ステップの専用コントロールへ(第59弾FB)。ここでは胴・肩幅・腕・手足だけ
  syncHeadsControl();
  for (const def of ADJUSTMENT_DEFS.filter((d) => d.key !== 'heads')) {
    const row = h('div', 'row');
    const label = h('label', null, def.label);
    label.htmlFor = `adj-${def.key}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `adj-${def.key}`;
    input.min = def.min;
    input.max = def.max;
    input.step = String(def.step);
    // 頭身(absolute)は未調整=プリセットの頭身を表示
    const current = adjustments[def.key]
      ?? (def.absolute ? Math.round(10 / baseRatios.head) / 10 : def.default);
    input.value = current;
    const value = h('span', 'adj-value', format(def, current));
    input.addEventListener('input', () => {
      adjustments[def.key] = Number(input.value);
      value.textContent = format(def, adjustments[def.key]);
      renderCalc();
    });
    row.append(label, input, value);
    box.append(row);
  }
}

// キャラ設定の「頭身」: プリセット(または参考画像から取り込んだ体型)の頭身を初期値に、
// 有料版では 2〜8 頭身を自由に(adjustments.heads)
function syncHeadsControl() {
  const baseRatios = importedRatios ?? PROPORTION_PRESETS[$('preset').value].ratios;
  const presetHeads = Math.round(10 / baseRatios.head) / 10;
  const cur = Number.isFinite(adjustments.heads) ? adjustments.heads : presetHeads;
  $('headsInput').value = String(cur);
  // 取り込み済みの体型では「プリセット」ではなく画像由来だと分かるように(第63弾FB: 6頭身固定に見える)
  const src = Number.isFinite(adjustments.heads) ? '' : (importedRatios ? '(参考画像から)' : '(プリセット)');
  $('headsValue').textContent = `${Number(cur).toFixed(1)}頭身${src}`;
  $('headsReset').hidden = !Number.isFinite(adjustments.heads);
  const locked = !LIMITS.adjustments;
  $('headsInput').disabled = locked;
  $('headsLocked').hidden = !locked;
}
function resetAdjustments() {
  adjustments = { ...DEFAULT_ADJUSTMENTS };
  buildAdjustSliders();
  renderCalc();
}

// ---- 保存 ----

function currentSaveData() {
  return {
    mode: 'calc',
    sizeMode: sizeMode('sizeMode'),
    modelHeightCm: Number($('height').value),
    preset: $('preset').value,
    adjustments: { ...adjustments },
    scaleDen: $('scale').value,
    targetHeightCm: Number($('targetHeight').value),
    importedRatios: importedRatios ? { ...importedRatios } : null,
    fleshVolume: { ...fleshVolume },
  };
}

function onSave() {
  const msg = $('saveMsg');
  msg.classList.remove('is-error');
  const name = $('saveName').value.trim();
  try {
    if (name && hasPreset(storage, name)
      && !window.confirm(`「${name}」は保存済みです。上書きしますか?`)) {
      return;
    }
    savePreset(storage, { name, data: currentSaveData(), savedAt: Date.now() },
      { limit: LIMITS.saveLimit });
    msg.textContent = `「${name}」を保存しました`;
  } catch (e) {
    msg.classList.add('is-error');
    msg.textContent = e.message;
  }
}

function loadSaved(item) {
  const d = item.data;
  // 旧形式(scaleMode: '8'|'custom')との互換: custom=完成サイズから、それ以外=身長から
  const mode = d.sizeMode ?? (d.scaleMode === 'custom' ? 'target' : 'height');
  const scaleDen = d.scaleDen ?? (d.scaleMode !== 'custom' ? d.scaleMode : null);
  const radio = document.querySelector(`input[name=sizeMode][value=${mode}]`);
  if (radio) radio.checked = true;
  if (Number.isFinite(d.modelHeightCm)) $('height').value = d.modelHeightCm;
  if (d.preset && [...$('preset').options].some((o) => o.value === d.preset)) {
    $('preset').value = d.preset;
  }
  if (scaleDen && [...$('scale').options].some((o) => o.value === scaleDen)) {
    $('scale').value = scaleDen;
  }
  if (Number.isFinite(d.targetHeightCm)) $('targetHeight').value = d.targetHeightCm;
  adjustments = { ...DEFAULT_ADJUSTMENTS, ...(d.adjustments ?? {}) };
  importedRatios = d.importedRatios && typeof d.importedRatios === 'object' ? { ...d.importedRatios } : null;
  fleshVolume = { ...DEFAULT_VOLUME, ...(d.fleshVolume ?? {}) };
  syncImportedNote();
  buildAdjustSliders();
  syncModeRows();
  $('saveName').value = item.name;
  renderCalc();
  showStep('finish'); // 履歴から開いたら仕上がり(寸法・切り出し)を表示
}

// 新規作成: 体型・取り込み・参考画像・ポーズ・表示位置を初期状態に戻す(第50弾FB)。保存データと表示設定(色など)は残す
function resetAll() {
  const radio = document.querySelector('input[name=sizeMode][value=target]');
  if (radio) radio.checked = true;
  $('targetHeight').value = 20;
  $('height').value = 160;
  if ([...$('scale').options].some((o) => o.value === '8')) $('scale').value = '8';
  $('preset').value = 'female-adult';
  adjustments = { ...DEFAULT_ADJUSTMENTS };
  importedRatios = null;
  fleshVolume = { ...DEFAULT_VOLUME };
  refImage.overlay = null; refImage.dragTarget = 'view';
  fitState.on = false; fitState.locked = false; fitState.joints = null; fitState.resumePose = false;
  pendingFitPose = null;
  const st = poseStates.get($('calcOutput'));
  if (st) { st.on = false; st.joints = null; st.viewport = null; st.twistUpper = 0; st.twistLower = 0; }
  $('saveName').value = '';
  uiLayout.viewMode = 'front'; // 新規作成は常に正面図から(第66弾FB)
  saveUiLayout();
  syncImportedNote();
  buildAdjustSliders();
  syncModeRows();
  fitSync();
  syncRefButtons();
  renderCalc();
  showStep('char');
}

function renderPresetList() {
  const list = $('presetList');
  const items = loadPresets(storage);
  $('saveHint').textContent = Number.isFinite(LIMITS.saveLimit)
    ? `保存は${LIMITS.saveLimit}件までです(有料版は無制限)。現在 ${items.length}/${LIMITS.saveLimit} 件`
    : `保存件数: ${items.length}件`;
  list.replaceChildren();
  if (items.length === 0) {
    list.append(h('li', 'hint', '保存データはまだありません。「仕上がり」ページから保存できます。'));
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    const date = item.savedAt ? new Date(item.savedAt).toLocaleDateString('ja-JP') : '';
    // 保存名をタップすると読み込んで仕上がり(詳細)を表示(第58弾FB)
    const nameBtn = h('button', 'preset-name linklike', item.name);
    nameBtn.type = 'button';
    nameBtn.addEventListener('click', () => loadSaved(item));
    li.append(nameBtn, h('span', 'preset-date', date));
    const loadBtn = h('button', null, '読み込み');
    loadBtn.type = 'button';
    loadBtn.addEventListener('click', () => loadSaved(item));
    const delBtn = h('button', 'danger', '削除');
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => {
      if (window.confirm(`「${item.name}」を削除しますか?`)) {
        deletePreset(storage, item.name);
        renderPresetList();
      }
    });
    li.append(loadBtn, delBtn);
    list.append(li);
  }
}

// ---- 材料・設定 ----

function renderMaterials() {
  const list = $('materials');
  list.replaceChildren(...MATERIALS.map((m) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = materialUrl(m);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = m.name;
    li.append(a, h('div', 'note', m.note), h('div', 'shops', `お店: ${m.shops}`));
    return li;
  }));
}

function initSettings() {
  // ビルド番号(デモ配信ではデプロイ時に <meta name="build"> を差し込む。PDが最新版かどうか確認できるように。第41弾FB)
  const build = document.querySelector('meta[name=build]')?.content;
  $('variantLabel').textContent = build ? `${VARIANT_LABEL}(build ${build})` : VARIANT_LABEL;
  $('newBtn').addEventListener('click', () => {
    if (window.confirm('新規作成しますか?(いまの体型・参考画像・ポーズは初期状態に戻ります。保存済みデータは残ります)')) resetAll();
  });
  $('clearData').addEventListener('click', () => {
    if (window.confirm('保存データをすべて削除しますか?この操作は取り消せません。')) {
      storage.removeItem(STORE_KEY);
      renderPresetList();
    }
  });
}

// ---- 起動 ----

// ---- 参考画像(キャラクターの設定) ----

function syncRefButtons() {
  // 位置ロック中でも参考画像は動かせる(ロックは「骨格の位置」を固定するもの。第65弾FB)
  const has = !!refImage.overlay?.src;
  for (const id of ['refMove', 'refZoomIn', 'refZoomOut', 'refShow', 'refFace', 'refAuto']) $(id).disabled = !has;
  $('refClear').disabled = !has;
  $('refMove').setAttribute('aria-pressed', String(has && refImage.dragTarget === 'overlay'));
  $('refShow').setAttribute('aria-pressed', String(has && !refImage.hidden));
  $('refShow').textContent = has && refImage.hidden ? '表示する' : '表示';
  $('refFace').setAttribute('aria-pressed', String(!!refImage.faceGuide));
}

function calcFig() {
  return poseStates.get($('calcOutput'))?.fig;
}

function setRefImage(dataUrl) {
  calcFig()?.setOverlay(dataUrl);
  refImage.hidden = false;
  calcFig()?.setOverlayHidden(false);
  // 画像を選んだら「顔の大きさを合わせる」から(骨組み調整タブへは移らない。第66弾FB)
  refImage.dragTarget = 'overlay';
  calcFig()?.setDragTarget('overlay');
  refImage.faceGuide = true;
  syncRefButtons();
  setRefStep('①画像の顔を骨格の頭の丸に合わせています…');
  renderCalc();
  // 選んだ時点で顔(なければ全身)を骨格に合わせて置く(手で合わせるのが大変=第67弾FB)
  alignRefImage().then(async (how) => {
    if (!how) {
      setRefStep('①画像をドラッグ/拡大縮小して、キャラクターの頭を骨格の頭の丸に重ねてください。');
      return;
    }
    renderCalc(); // refImage.overlay は onOverlayChange で更新済み
    // 顔を合わせただけだと骨格の方が大きく(小さく)見えるので、続けて骨格も合わせる(第68弾FB)
    await autoFitToImage({ chain: true });
    setRefStep(`${how === 'head' ? '顔' : '全身'}を認識して、画像と骨格を合わせました(点線が認識した範囲)。ずれていれば①②をやり直すか、③関節を手で調整してください。`);
  });
}
// 参考画像の手順の案内(参考画像の区分に出す)
function setRefStep(text) {
  const el = $('refStep');
  el.textContent = text ?? '';
  el.hidden = !text;
}

// 骨格調整(参考画像の区分から操作): 参考画像に骨格を合わせて体型を取り込む
let fitSync = () => {};
let importFit = () => {}; // 「取り込んで終える」の本体(initFit で設定)
let fitFlash = ''; // 骨格合わせ終了時の一言(次の描画で1回だけ表示)
let pendingFitPose = null; // 取り込み直後にポーズへ引き継ぐ正面図の関節位置(px)
function enterFit(locked) {
  fitState.on = true;
  fitState.locked = !!locked;
  // 関節を調整するあいだは参考画像を動かさない(誤って画像がずれないように。第66弾FB)
  refImage.faceGuide = false;
  if (refImage.dragTarget === 'overlay') { refImage.dragTarget = 'view'; calcFig()?.setDragTarget('view'); }
  syncRefButtons();
  // 合わせている間はポーズ側は使わない(骨長が変わるため)。ポーズはOFFにし、終了時に元へ戻す
  const st = poseStates.get($('calcOutput'));
  if (st) { fitState.resumePose = st.on; st.on = false; }
  fitSync();
  // 区分は勝手に切り替えない(操作は「参考画像」の区分で完結する。第66弾FB)
  renderCalc();
  $('calcOutput').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function exitFit() {
  fitState.on = false; fitState.locked = false; fitState.joints = null;
  const st = poseStates.get($('calcOutput'));
  if (st && fitState.resumePose) st.on = true;
  fitState.resumePose = false;
}
function initFit() {
  const sync = () => {
    $('fitToggle').setAttribute('aria-pressed', String(fitState.on));
    $('fitLock').hidden = !fitState.on;
    $('fitLock').setAttribute('aria-pressed', String(fitState.locked));
    $('fitLock').textContent = fitState.locked ? '位置をロック中(解除)' : '位置をロック';
    syncRefButtons();
  };
  fitSync = sync;
  $('fitToggle').addEventListener('click', () => {
    if (fitState.on) {
      exitFit();
      sync(); renderCalc(); return;
    }
    enterFit(true);
  });
  $('fitLock').addEventListener('click', () => {
    fitState.locked = !fitState.locked;
    calcFig()?.setFitLocked(fitState.locked);
    sync();
    // 表示位置ボタンの表示切替のため再描画(骨格の位置は fitState.joints から復元される)
    const fig = calcFig();
    if (fig) fitState.joints = fig.getJoints();
    renderCalc();
  });
  importFit = () => {
    const fig = calcFig();
    if (!fig) return;
    const errBox = $('calcError');
    try {
      const px = fig.getFrontJointsPx();
      const base = importedRatios ?? PROPORTION_PRESETS[$('preset').value].ratios;
      const ratios = ratiosFromJoints(px, base);
      // 取り込み後の骨格は標準位置(頭頂=上端pad、股=既定x、全高=枠いっぱい)に描き直されるので、
      // 参考画像も同じ変換で動かして骨格とのズレを防ぐ(PD追加コメント「取り込み後にズレる」)
      // 骨格を動かしていない(直立のまま)なら位置は変わらないので参考画像も動かさない
      // (丸め誤差で取り込みのたびにわずかに動く累積ズレを防ぐ)
      if (refImage.overlay?.src && fig.isPosed()) {
        const std = fig.standardFrame(); // { topY, soleY, hipX } 標準位置(px)
        const topY = px.top.y;
        const soleY = Math.max(px.heelL.y, px.heelR.y);
        const scale = (std.soleY - std.topY) / Math.max(1, soleY - topY);
        const ov = refImage.overlay;
        const c0 = { x: 170 + ov.t.x, y: 230 + ov.t.y }; // 現在の中心(VIEW_W/2, VIEW_H/2 基準)
        // 股を基準に合わせる(取り込み後の骨格は股を root にポーズを引き継ぐため、股が正確に重なる)
        const stdHipY = std.topY + (std.soleY - std.topY) * ratios.hipTop;
        const anchor = { x: px.hip.x, y: px.hip.y };
        const c1 = { x: std.hipX + (c0.x - anchor.x) * scale, y: stdHipY + (c0.y - anchor.y) * scale };
        refImage.overlay = { ...ov, s: ov.s * scale, t: { x: c1.x - 170, y: c1.y - 230 } };
      }
      // 合わせた関節の向きをポーズとして引き継ぐ(腕・脚の位置が直立に戻らない)
      pendingFitPose = px;
      // 取り込んだ体型がそのまま出るよう、体型調整(頭身など)は既定に戻す(取り込み前の調整が上書きしないように)
      adjustments = { ...DEFAULT_ADJUSTMENTS };
      exitFit();
      const st = poseStates.get($('calcOutput'));
      if (st) { st.joints = null; st.on = true; } // 骨長が変わるのでポーズは直立から。取り込んだらすぐポーズを付けられるようにON
      sync();
      setImportedRatios(ratios); // renderCalc → 再描画
      errBox.hidden = true;
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent = `体型の取り込みに失敗しました: ${e.message}`;
    }
  };
  sync();
  if (IS_FREE) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = '無料版では体型の取り込み1回につき広告が1回表示されます(モバイル版)。';
    $('fitToggle').closest('.row').after(note);
  }
}

function initRefImage() {
  $('refFile').addEventListener('change', () => {
    const file = $('refFile').files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRefImage(reader.result);
    reader.readAsDataURL(file);
    $('refFile').value = '';
  });
  $('refMove').addEventListener('click', () => {
    refImage.dragTarget = refImage.dragTarget === 'overlay' ? 'view' : 'overlay';
    calcFig()?.setDragTarget(refImage.dragTarget);
    syncRefButtons();
  });
  $('refZoomIn').addEventListener('click', () => calcFig()?.overlayZoom(1.2));
  $('refZoomOut').addEventListener('click', () => calcFig()?.overlayZoom(1 / 1.2));
  // 一時的に消す/戻す(第66弾FB。「消す」と違って選び直さなくてよい)
  $('refShow').addEventListener('click', () => {
    refImage.hidden = !refImage.hidden;
    calcFig()?.setOverlayHidden(refImage.hidden);
    syncRefButtons();
  });
  // ① 顔の大きさを合わせる: 画像を動かすモード+骨格の頭の丸を強調(第66弾FB)
  $('refFace').addEventListener('click', () => {
    refImage.faceGuide = !refImage.faceGuide;
    if (refImage.faceGuide) {
      refImage.dragTarget = 'overlay';
      calcFig()?.setDragTarget('overlay');
      setRefStep('①顔の大きさを合わせています…');
      syncRefButtons();
      renderCalc();
      // もう一度押したら自動で合わせ直す(そのあと画像のドラッグ・拡大縮小で微調整)
      alignRefImage().then((how) => {
        setRefStep(how
          ? '①顔の大きさを合わせました。ずれていれば画像をドラッグ・拡大縮小で微調整してください。'
          : '①画像をドラッグ/拡大縮小して、キャラクターの頭を骨格の頭の丸に重ねてください。');
        renderCalc();
      });
      return;
    }
    setRefStep('');
    syncRefButtons();
    renderCalc();
  });
  // ② 参考画像の人物に骨格を自動で合わせる(前景検出→頭の大きさはそのままで全身を合わせる)
  $('refAuto').addEventListener('click', () => autoFitToImage());
  $('refClear').addEventListener('click', () => {
    calcFig()?.clearOverlay();
    refImage.dragTarget = 'view';
    refImage.faceGuide = false;
    refImage.hidden = false;
    refImage.marks = null;
    calcFig()?.setDragTarget('view');
    setRefStep('');
    syncRefButtons();
    // 画像を消したら合わせる対象がなくなるので骨格合わせも終える(取り込まない)
    if (fitState.on) { exitFit(); fitSync(); renderCalc(); } else { renderCalc(); }
  });
  syncRefButtons();
}

// 参考画像を解析用に縮小して読み込む(重い処理を避けるため最大320px)
function loadRefForAnalysis() {
  const ov = refImage.overlay;
  if (!ov?.src) return Promise.resolve(null);
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 320;
        const sc = Math.min(1, MAX / Math.max(img.width, img.height));
        const cw = Math.max(1, Math.round(img.width * sc));
        const ch = Math.max(1, Math.round(img.height * sc));
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, cw, ch);
        done({ img, cw, ch, imageData: ctx.getImageData(0, 0, cw, ch) });
      } catch { done(null); }
    };
    img.onerror = () => done(null);
    img.src = ov.src;
  });
}

// 参考画像を骨格に合わせて置く(第67弾FB「顔に合わせると言われても位置が合わず調整が困難」)。
// 頭(頭頂〜首)を検出できたら顔の大きさを骨格の頭に合わせ、だめなら全身の範囲で合わせる。
async function alignRefImage() {
  const fig = calcFig();
  const ov = refImage.overlay;
  if (!fig || !ov?.src) return false;
  const src = await loadRefForAnalysis();
  if (!src) return false;
  const { img, cw, ch } = src;
  const std = fig.standardFrame(); // { topY, soleY, hipX }
  const head = detectHead(src.imageData);
  const box = head.found ? head.box : detectFigureBox(src.imageData);
  if (!box.found) return false;
  // 画像のどの範囲を、骨格のどの範囲に合わせるか(いずれも「縦の区間」+「横の中心」)
  const headPx = fig.headHeightPx();
  const from = head.found
    ? { a: head.top / ch, b: head.neckY / ch, cx: head.centerX / cw }
    : { a: box.top / ch, b: box.bottom / ch, cx: box.centerX / cw };
  const to = head.found
    ? { a: std.topY, b: std.topY + headPx }
    : { a: std.topY, b: std.soleY };
  const span = from.b - from.a;
  if (!(span > 0.01)) return false;
  const dh = (to.b - to.a) / span;           // 画像全体の描画高さ(px)
  const drawS = dh / img.height;
  const scale = drawS * Math.max(img.width / VIEW_W_PX, img.height / VIEW_H_PX);
  const dw = img.width * drawS;
  const dy = to.a - from.a * dh;
  const dx = std.hipX - from.cx * dw;
  fig.setOverlayFrame({ s: scale, tx: dx - VIEW_W_PX / 2 + dw / 2, ty: dy - VIEW_H_PX / 2 + dh / 2 });
  // どこを顔・足元と認識したかを図に重ねて見せる(第68弾FB)
  const sx = (ix) => dx + (ix / cw) * dw;
  const sy = (iy) => dy + (iy / ch) * dh;
  refImage.marks = {
    head: head.found ? { x: sx(head.left), y: sy(head.top), w: sx(head.right) - sx(head.left), h: sy(head.neckY) - sy(head.top) } : null,
    body: { top: sy(box.top), bottom: sy(box.bottom), cx: sx(box.centerX) },
  };
  fig.setDetectMarks(refImage.marks);
  return head.found ? 'head' : 'body';
}

// 参考画像の人物(前景)を検出して骨格を合わせる(第66弾FB「参考画像に合わせて骨格を自動調整」)。
// 人物認識(ML)ではなく、背景色との差から人物の上端・下端・中心を求める軽量な方法(js/core/imagefit.js)。
async function autoFitToImage({ chain = false } = {}) {
  const ov = refImage.overlay;
  if (!ov?.src) return;
  if (!chain) setRefStep('②自動で合わせています…');
  const src = await loadRefForAnalysis();
  if (!src) { setRefStep('画像を読み込めませんでした。'); return; }
  const { img, cw, ch } = src;
  {
    try {
      const box = detectFigureBox(src.imageData);
      if (!box.found) {
        setRefStep('自動では人物の範囲を見つけられませんでした(背景が複雑な画像は苦手です)。「③関節を手で調整する」で合わせてください。');
        return;
      }
      // 画像は <image> に xMidYMid meet で描かれる。画面(SVG)座標へ変換する
      const boxW = VIEW_W_PX * ov.s; const boxH = VIEW_H_PX * ov.s;
      const drawS = Math.min(boxW / img.width, boxH / img.height);
      const dw = img.width * drawS; const dh = img.height * drawS;
      const dx = VIEW_W_PX / 2 - boxW / 2 + ov.t.x + (boxW - dw) / 2;
      const dy = VIEW_H_PX / 2 - boxH / 2 + ov.t.y + (boxH - dh) / 2;
      const toSvgY = (iy) => dy + (iy / ch) * dh;
      const toSvgX = (ix) => dx + (ix / cw) * dw;
      if (!fitState.on) enterFit(true); // 自動で合わせたあと手で直せるように調整モードへ
      const fig = calcFig();
      const ok = fig?.autoFitTo({
        topPx: toSvgY(box.top), bottomPx: toSvgY(box.bottom), centerXPx: toSvgX(box.centerX),
      });
      if (ok) {
        fitState.joints = fig.getJoints();
        // 認識した足元の位置も見せる(第68弾FB)
        refImage.marks = {
          ...(refImage.marks ?? {}),
          body: { top: toSvgY(box.top), bottom: toSvgY(box.bottom), cx: toSvgX(box.centerX) },
        };
        fig.setDetectMarks(refImage.marks);
        if (!chain) setRefStep('②自動で合わせました(点線が認識した範囲)。ずれている関節は「③関節を手で調整する」で直してください。');
      } else {
        setRefStep('自動で合わせられませんでした。「③関節を手で調整する」で合わせてください。');
      }
    } catch (e) {
      setRefStep(`自動で合わせられませんでした(${e.message})。手で調整してください。`);
    }
  }
}

function main() {
  fillSelects();
  syncModeRows();
  buildAdjustSliders();
  initRefImage();
  initFit();
  renderMaterials();
  initSettings();

  for (const btn of document.querySelectorAll('.tabbar button')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }
  // ページ間の流れ(第58弾FB): キャラ設定 →(設定)→ 骨格 →(骨組み完成)→ 仕上がり。新規作成はキャラ設定へ
  $('toSkel').addEventListener('click', () => showStep('skel'));
  $('skelDone').addEventListener('click', () => showStep('finish'));
  // 「設定に戻る」は実質やり直し(第64弾FB: 新規作成ボタンは置かず、ここで破棄の確認をする)
  $('skelBack').addEventListener('click', () => {
    if (window.confirm('キャラ設定に戻ります。いまの骨組み(参考画像・骨格の調整・ポーズ)は破棄されます。よろしいですか?')) resetAll();
  });
  $('finishBack').addEventListener('click', () => showStep('skel'));
  for (const b of document.querySelectorAll('.stepbar button')) b.addEventListener('click', () => showStep(b.dataset.step));
  // 図の切り替え(正面/左側面/右側面/三面/3D)
  for (const b of document.querySelectorAll('#viewSwitch button[data-view]')) {
    b.addEventListener('click', () => { uiLayout.viewMode = b.dataset.view; saveUiLayout(); renderCalc(); applyViewMode(); });
  }
  // 3Dの視点変更(第65弾FB。見上げ・見下ろしは第66弾FB)
  $('turnLeft').addEventListener('click', () => turnView({ yaw: -15 }));
  $('turnRight').addEventListener('click', () => turnView({ yaw: 15 }));
  $('turnUp').addEventListener('click', () => turnView({ pitch: -15 }));
  $('turnDown').addEventListener('click', () => turnView({ pitch: 15 }));
  $('turnReset').addEventListener('click', () => turnView({ yaw: 0, pitch: 0, absolute: true }));
  // サイドメニュー
  for (const b of document.querySelectorAll('#sideRail button[data-sec]')) b.addEventListener('click', () => openSection(b.dataset.sec));
  $('sideClose').addEventListener('click', () => { $('sidePanel').hidden = true; document.body.classList.remove('side-open'); for (const b of document.querySelectorAll('#sideRail button[data-sec]')) b.setAttribute('aria-pressed', 'false'); });
  $('gizmoSpeed').value = String(uiLayout.gizmoSpeed);
  $('gizmoSpeedValue').textContent = uiLayout.gizmoSpeed.toFixed(1);
  $('gizmoSpeed').addEventListener('input', () => {
    uiLayout.gizmoSpeed = Number($('gizmoSpeed').value);
    $('gizmoSpeedValue').textContent = uiLayout.gizmoSpeed.toFixed(1);
  });
  $('gizmoSpeed').addEventListener('change', saveUiLayout);
  $('menuSide').value = uiLayout.menuSide;
  $('menuSide').addEventListener('change', () => { uiLayout.menuSide = $('menuSide').value; saveUiLayout(); applyMenuSide(); });
  applyMenuSide();
  buildGizmo();
  syncTabbarHeight();
  window.addEventListener('resize', () => { syncTabbarHeight(); scheduleFigureHeight(); });
  // 広い画面ではパネルを常時表示
  const wide = window.matchMedia('(min-width: 900px)');
  const syncWide = () => { if (wide.matches) openSection(uiLayout.section, false); };
  wide.addEventListener('change', syncWide); syncWide();
  for (const radio of document.querySelectorAll('input[name=sizeMode]')) {
    radio.addEventListener('change', () => { syncModeRows(); renderCalc(); });
  }
  $('scale').addEventListener('change', renderCalc);
  for (const id of ['height', 'targetHeight']) {
    $(id).addEventListener('input', renderCalc);
  }
  $('preset').addEventListener('change', () => {
    buildAdjustSliders(); // 未調整の頭身表示をプリセットに追従させる
    renderCalc();
  });
  $('adjustReset').addEventListener('click', resetAdjustments);
  $('importedReset').addEventListener('click', () => setImportedRatios(null));
  syncImportedNote();
  $('saveBtn').addEventListener('click', onSave);

  if (IS_FREE) {
    $('adjustPanel').hidden = true;
    $('adjustLocked').hidden = false;
  }
  $('headsInput').addEventListener('change', () => {
    const v = Number($('headsInput').value);
    if (!Number.isFinite(v) || v < 2 || v > 8) { syncHeadsControl(); return; }
    adjustments.heads = v;
    syncHeadsControl();
    renderCalc();
  });
  // 3Dソフト用の書き出し(OBJ)。いまの骨格(ポーズ込み)を cm 単位で(第60弾FB)
  $('exportObj').addEventListener('click', () => {
    try {
      const result = computeArmature(readCalcInput());
      const st = poseStates.get($('calcOutput'));
      const joints = st?.fig?.getJoints?.() ?? restPose(result.segments);
      const name = ($('saveName').value.trim() || 'shinzai');
      const obj = buildObj(joints, result.segments, { name, wireMm: result.wireDiameterMm, flesh: $('exportFlesh').checked });
      const blob = new Blob([obj], { type: 'model/obj' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.obj`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      $('saveMsg').textContent = `${name}.obj を書き出しました(単位 cm)。`;
    } catch (e) {
      $('saveMsg').textContent = `書き出しに失敗しました: ${e.message}`;
    }
  });
  $('headsReset').addEventListener('click', () => { adjustments.heads = null; syncHeadsControl(); renderCalc(); });

  renderCalc();

  // スモークテスト用の開発フック(画像入力をdataURLで直接流し込む)
  window.__debug = {
    setOverlay: (dataUrl) => setRefImage(dataUrl),
    // スモークテスト用: 全ページ・全区分・三面を同時に表示(要素の可視性に依存する操作を通すため)
    showStep,
    testLayout: () => {
      uiLayout.allTabs = true; uiLayout.allSections = true; uiLayout.allSteps = true; uiLayout.viewMode = 'all';
      showStep('char'); openSection('frame', false); applyViewMode();
    },
  };
}

main();
