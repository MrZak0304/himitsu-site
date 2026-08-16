// js/app.js — UI配線のみ。計算ロジックは js/core/ に置き、ここには書かない。
import { computeArmature, SCALE_CHOICES } from './core/armature.js';
import { PROPORTION_PRESETS } from './core/proportions.js';
import {
  applyAdjustments, ADJUSTMENT_DEFS, DEFAULT_ADJUSTMENTS, isAdjusted,
} from './core/adjustments.js';
import { ratiosFromJoints } from './core/skeleton2d.js';
import {
  loadPresets, savePreset, deletePreset, hasPreset, STORE_KEY,
} from './core/presets-store.js';
import { createPoseFigure } from './ui/posefig.js';
import { DRAGGABLE as POSE_JOINTS, JOINT_LABELS as POSE_LABELS, restPose, poseFromFit } from './core/pose3d.js';
import { MATERIALS, materialUrl } from './affiliates.js';
import { IS_FREE, LIMITS, VARIANT_LABEL } from './build-flags.js';

const $ = (id) => document.getElementById(id);
const storage = window.localStorage;
let adjustments = { ...DEFAULT_ADJUSTMENTS };
let showFlesh = false; // 肉付けイメージの表示(両タブ共通)
const poseStates = new WeakMap(); // 出力領域ごとのポーズ状態(計算タブ/画像からタブで独立)
// 参考画像(キャラクターの設定で選ぶ。芯材計算タブの正面図の背面に表示。第18〜19弾FB)
const refImage = { overlay: null, dragTarget: 'view' };
// 参考画像から取り込んだ体型(比率セット)。null ならプリセット(第2段階=一体化)
let importedRatios = null;
// 骨格合わせ(体型合わせ)モード。キャラクターの設定から操作(第23弾FB)。芯材計算タブのみ
const fitState = { on: false, joints: null, locked: false };
const uiAids = { axisLock: false, mirror: false, big: false, fitFree: false };
// 骨格ページの表示(第58弾FB UI改修): viewMode=正面/左側面/右側面/三面、menuSide=サイドメニューの位置(設定)
const uiLayout = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('shinzaiMaker.ui') || '{}') || {}; } catch { /* ignore */ }
  return { viewMode: saved.viewMode ?? 'front', menuSide: saved.menuSide ?? 'right', section: 'frame' };
})();
function saveUiLayout() { try { localStorage.setItem('shinzaiMaker.ui', JSON.stringify({ viewMode: uiLayout.viewMode, menuSide: uiLayout.menuSide })); } catch { /* ignore */ } }
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
  for (const btn of document.querySelectorAll('.tabbar button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  }
  if (name === 'save') renderPresetList();
  if (name === 'skel') applyViewMode();
}
// 骨格ページ: メイン図の切り替え(正面/左側面/右側面/三面)
function applyViewMode() {
  const mode = uiLayout.viewMode;
  for (const b of document.querySelectorAll('#viewSwitch button')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  const views = document.querySelector('#calcOutput .views');
  if (!views) return;
  views.classList.toggle('single', mode !== 'all');
  const order = ['front', 'side-left', 'side-right'];
  views.querySelectorAll('.view').forEach((v, i) => v.classList.toggle('active', mode === 'all' || order[i] === mode));
}
// サイドメニュー(骨格ページ): レールのボタンで区分を開閉
function openSection(sec, toggle = true) {
  const panel = $('sidePanel');
  const same = uiLayout.section === sec && !panel.hidden;
  if (toggle && same) { panel.hidden = true; }
  else { uiLayout.section = sec; panel.hidden = false; }
  for (const b of document.querySelectorAll('#sideRail button')) b.setAttribute('aria-pressed', String(!panel.hidden && b.dataset.sec === uiLayout.section));
  for (const sc of document.querySelectorAll('#sidePanel .side-sec')) sc.hidden = uiLayout.allSections ? false : sc.dataset.sec !== uiLayout.section;
  document.body.classList.toggle('side-open', !panel.hidden);
}
function applyMenuSide() {
  $('skelLayout').classList.toggle('side-left', uiLayout.menuSide === 'left');
  document.body.classList.toggle('menu-left', uiLayout.menuSide === 'left');
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
    frame: sides?.frame ?? root, flesh: sides?.flesh ?? root, pose: sides?.pose ?? root, sample: sides?.sample ?? root,
  };
  for (const el0 of new Set([S.frame, S.flesh, S.pose, S.sample])) if (el0 !== root) el0.replaceChildren();
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
  const fleshBtn = h('button', 'toggle flesh-toggle-btn', '肉付けイメージ');
  fleshBtn.type = 'button';
  fleshBtn.setAttribute('aria-pressed', String(showFlesh));
  const poseBtn = h('button', 'toggle pose-toggle-btn', 'ポーズを取る');
  poseBtn.type = 'button';
  poseBtn.setAttribute('aria-pressed', String(poseState.on));
  if (sides) { S.flesh.append(fleshBtn); S.pose.append(poseBtn); toggleRow.append(); root.append(toggleRow); toggleRow.hidden = true; }
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
  volRow.append(shapeRow);
  fleshOpts.append(volRow);
  S.flesh.append(fleshOpts);

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
  const mirrorBtn = h('button', 'toggle mirror-btn', '左右対称');
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
  // 骨格合わせの終了操作を図のすぐ上に置く(上の「キャラクターの設定」まで戻らなくてよい。第29弾FB)
  const fitLockBtn = h('button', 'toggle fit-lock-btn', '位置をロック');
  fitLockBtn.type = 'button';
  const fitDoneBtn = h('button', 'fit-done-btn', '取り込んで終える');
  fitDoneBtn.type = 'button';
  const fitCancelBtn = h('button', 'ghost fit-cancel-btn', '取り込まずに終える');
  fitCancelBtn.type = 'button';
  // 腕・脚の関節は既定で「回す(持ち上げる)」。長さを変えるときだけON(第45弾FB「腕が伸びる」)
  const fitFreeBtn = h('button', 'toggle fit-free-btn', '長さも動かす');
  fitFreeBtn.type = 'button';
  const fitActions = h('div', 'fit-actions');
  fitActions.append(fitLockBtn, fitDoneBtn, fitCancelBtn, fitFreeBtn);
  fitActions.hidden = true;
  const fitDone = h('p', 'hint fit-done-msg', '');
  fitDone.hidden = true;
  if (sides) {
    // 図の上: 案内だけ。骨組み調整: 取り込み/終了/ロック/長さ・ポーズ中の「骨格を調整する」。ポーズ設定: ひねり/リセット/表示/補助/ヒント
    poseTools.append(poseHint, fitNote);
    S.frame.append(fitActions, toFitRow);
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
      onStatus: (t) => { poseHint.textContent = t; },
      onJointPick: (id) => { if ([...jointSel.options].some((o) => o.value === id)) jointSel.value = id; },
      viewport: poseState.on ? poseState.viewport : null,
      axisLock: uiAids.axisLock,
      mirror: uiAids.mirror,
      fitFree: uiAids.fitFree,
      volume: fleshVolume,
      big: uiAids.big,
      onViewportChange: (vp) => { poseState.viewport = vp; },
      // 参考画像は芯材計算タブ(キャラクターの設定)の正面図にだけ表示。ポーズON/OFFに関わらず出す
      overlay: root.id === 'calcOutput' ? refImage.overlay : null,
      dragTarget: root.id === 'calcOutput' ? refImage.dragTarget : 'view',
      onOverlayChange: (ov) => { if (root.id === 'calcOutput') { refImage.overlay = ov; syncRefButtons(); } },
      onPoseChange: (joints, posed) => {
        if (fitOn) { fitState.joints = posed ? joints : null; return; }
        poseState.joints = posed ? joints : null;
        poseHint.textContent = posed ? GUIDE_POSED : GUIDE_IDLE;
      },
    });
    poseState.fig = fig;
    poseTools.hidden = !(poseState.on || fitOn);
    if (poseTools._poseGroup) poseTools._poseGroup.hidden = !(poseState.on || fitOn);
    if (sides) applyViewMode();
    // 骨格合わせ中はポーズ専用の操作(ひねり・関節リセット・ポーズ切替)を隠し、表示位置の操作だけ残す
    // 骨格合わせ中はひねり・関節リセットを無効表示(隠すと「消えた」と見えるため。第27弾FB)
    for (const n of [twistUp.row, twistLo.row, poseButtons]) n.classList.toggle('is-disabled', fitOn);
    for (const el2 of [twistUp.input, twistUp.zero, twistLo.input, twistLo.zero, resetOne, resetAll, jointSel]) el2.disabled = fitOn;
    fitNote.hidden = true; // 文字量削減(第47弾FB): 無効表示で伝わるので注記は出さない
    fitActions.hidden = !fitOn;
    fitLockBtn.setAttribute('aria-pressed', String(fitState.locked));
    fitFreeBtn.setAttribute('aria-pressed', String(uiAids.fitFree));
    fitLockBtn.textContent = fitState.locked ? '位置をロック中(解除)' : '位置をロック';
    poseHint.classList.toggle('fit-banner', fitOn);
    toFitRow.hidden = sides ? true : !(isCalc && !fitOn); // サイドメニューでは「骨格を調整する」ボタンが同区分にあるので不要
    // 位置ロック中は表示位置の操作も隠す(関節以外は動かさない)
    // 位置ロック中でも拡大/縮小/収めるは使える(図と画像が一緒に動くので位置関係は崩れない。第33弾FB「操作範囲を大きく」)。
    // 背景ドラッグ・2本指は引き続き無効(fitLocked)
    viewHint.hidden = fitOn && fitState.locked;
    views.classList.toggle('big', uiAids.big && (poseState.on || fitOn));
    poseBtn.disabled = fitOn;
    if (isCalc) toggleRow.hidden = false;
    if (fitOn) {
      poseHint.textContent = (fitIntro ? `${fitIntro} ` : '骨格調整中: 点を動かし、') + '「取り込んで終える」で終了。';
      fitIntro = '';
    } else if (poseState.on) {
      poseHint.textContent = poseState.joints ? GUIDE_POSED : GUIDE_IDLE;
    }
  };
  fleshBtn.addEventListener('click', () => {
    showFlesh = !showFlesh;
    renderCalc();
  });
  toFitBtn.addEventListener('click', () => enterFit(true));
  fitLockBtn.addEventListener('click', () => $('fitLock').click());
  fitFreeBtn.addEventListener('click', () => {
    uiAids.fitFree = !uiAids.fitFree;
    fitFreeBtn.setAttribute('aria-pressed', String(uiAids.fitFree));
    poseState.fig?.setFitFree(uiAids.fitFree);
  });
  fitDoneBtn.addEventListener('click', () => $('fitImport').click());
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
    mirrorBtn.setAttribute('aria-pressed', String(uiAids.mirror));
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
      sides: { frame: $('secFrame'), flesh: $('secFlesh'), pose: $('secPose'), sample: $('secSample') },
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
  for (const def of ADJUSTMENT_DEFS) {
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
  showTab('finish'); // 履歴から開いたら仕上がり(寸法・切り出し)を表示
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
  syncImportedNote();
  buildAdjustSliders();
  syncModeRows();
  fitSync();
  syncRefButtons();
  renderCalc();
  showTab('char');
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
  const has = !!refImage.overlay?.src;
  const locked = fitState.on && fitState.locked;
  for (const id of ['refMove', 'refZoomIn', 'refZoomOut']) $(id).disabled = !has || locked;
  $('refClear').disabled = !has;
  $('refMove').setAttribute('aria-pressed', String(has && !locked && refImage.dragTarget === 'overlay'));
}

function calcFig() {
  return poseStates.get($('calcOutput'))?.fig;
}

function setRefImage(dataUrl) {
  calcFig()?.setOverlay(dataUrl);
  refImage.dragTarget = 'overlay';
  calcFig()?.setDragTarget('overlay');
  syncRefButtons();
  // 画像を選んだら、そのまま「参考画像に骨格を合わせる」に入る(最初にやることを1つにする。第30弾FB)
  if (!fitState.on) {
    fitFlash = '参考画像を選びました。画像を合わせ、点をキャラクターに重ねてください。';
    enterFit(false);
  }
}

// 骨格合わせ(キャラクターの設定): 参考画像に骨格を合わせて体型を取り込む
let fitSync = () => {};
let fitFlash = ''; // 骨格合わせ終了時の一言(次の描画で1回だけ表示)
let pendingFitPose = null; // 取り込み直後にポーズへ引き継ぐ正面図の関節位置(px)
function enterFit(locked) {
  fitState.on = true;
  fitState.locked = !!locked;
  // 合わせている間はポーズ側は使わない(骨長が変わるため)。ポーズはOFFにし、終了時に元へ戻す
  const st = poseStates.get($('calcOutput'));
  if (st) { fitState.resumePose = st.on; st.on = false; }
  fitSync();
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
    $('fitImport').hidden = !fitState.on;
    $('fitLock').hidden = !fitState.on;
    $('fitLock').setAttribute('aria-pressed', String(fitState.locked));
    $('fitLock').textContent = fitState.locked ? '位置をロック中(解除)' : '位置をロック';
    // ロック中は参考画像を動かせない(骨格との位置関係を固定)
    if (fitState.on && fitState.locked) {
      refImage.dragTarget = 'view';
      calcFig()?.setDragTarget('view');
    }
    syncRefButtons();
  };
  fitSync = sync;
  $('fitToggle').addEventListener('click', () => {
    if (fitState.on) {
      exitFit();
      fitFlash = '骨格の調整を終了しました(取り込みなし)。';
      sync(); renderCalc(); return;
    }
    enterFit(false);
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
  $('fitImport').addEventListener('click', () => {
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
      fitFlash = '体型に取り込みました。ポーズを付けられます。';
      setImportedRatios(ratios); // renderCalc → 再描画
      errBox.hidden = true;
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent = `体型の取り込みに失敗しました: ${e.message}`;
    }
  });
  sync();
  if (IS_FREE) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = '無料版では体型の取り込み1回につき広告が1回表示されます(モバイル版)。';
    $('fitImport').closest('.row').after(note);
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
  $('refClear').addEventListener('click', () => {
    calcFig()?.clearOverlay();
    refImage.dragTarget = 'view';
    calcFig()?.setDragTarget('view');
    syncRefButtons();
    // 画像を消したら合わせる対象がなくなるので骨格合わせも終える(取り込まない)
    if (fitState.on) { exitFit(); fitFlash = '参考画像を消したので骨格の調整を終了しました(取り込みなし)。'; fitSync(); renderCalc(); }
  });
  syncRefButtons();
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
  $('toSkel').addEventListener('click', () => showTab('skel'));
  $('skelDone').addEventListener('click', () => showTab('finish'));
  $('skelNew').addEventListener('click', () => { if (window.confirm('新規作成しますか?(いまの体型・参考画像・ポーズは初期状態に戻ります。保存済みデータは残ります)')) resetAll(); });
  // 図の切り替え
  for (const b of document.querySelectorAll('#viewSwitch button')) {
    b.addEventListener('click', () => { uiLayout.viewMode = b.dataset.view; saveUiLayout(); applyViewMode(); });
  }
  // サイドメニュー
  for (const b of document.querySelectorAll('#sideRail button')) b.addEventListener('click', () => openSection(b.dataset.sec));
  $('sideClose').addEventListener('click', () => { $('sidePanel').hidden = true; openSection(uiLayout.section, false); $('sidePanel').hidden = true; document.body.classList.remove('side-open'); for (const b of document.querySelectorAll('#sideRail button')) b.setAttribute('aria-pressed', 'false'); });
  $('menuSide').value = uiLayout.menuSide;
  $('menuSide').addEventListener('change', () => { uiLayout.menuSide = $('menuSide').value; saveUiLayout(); applyMenuSide(); });
  applyMenuSide();
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

  renderCalc();

  // スモークテスト用の開発フック(画像入力をdataURLで直接流し込む)
  window.__debug = {
    setOverlay: (dataUrl) => setRefImage(dataUrl),
    // スモークテスト用: 全ページ・全区分・三面を同時に表示(要素の可視性に依存する操作を通すため)
    testLayout: () => {
      uiLayout.allTabs = true; uiLayout.allSections = true; uiLayout.viewMode = 'all';
      showTab('char'); openSection('frame', false); applyViewMode();
    },
  };
}

main();
