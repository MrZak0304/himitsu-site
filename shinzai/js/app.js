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
import { DRAGGABLE as POSE_JOINTS, JOINT_LABELS as POSE_LABELS } from './core/pose3d.js';
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
const fitState = { on: false, joints: null };

// ---- タブ ----

function showTab(name) {
  for (const section of document.querySelectorAll('main .tab')) {
    section.hidden = section.dataset.tab !== name;
  }
  for (const btn of document.querySelectorAll('.tabbar button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  }
  if (name === 'save') renderPresetList();
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

function renderResultInto(root, result, { showScale = true } = {}) {
  root.replaceChildren();
  root.hidden = false;
  const scalePart = showScale ? `${result.scaleLabel} スケール / ` : '';
  root.append(
    h('h2', null, '骨格と寸法'),
    h('p', 'summary',
      `${scalePart}完成サイズ 約${result.figureHeightCm}cm / ` +
      `推奨アルミ線径 ${result.wireDiameterMm}mm(2本撚り)`),
  );

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
  toggleRow.append(fleshBtn, poseBtn);
  root.append(toggleRow);

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
  const viewHint = h('p', 'hint', '図の背景をドラッグで移動、2本指で拡大縮小できます。');
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
  poseTools.append(poseHint, twistUp.row, twistLo.row, poseButtons, viewRow, viewHint);
  root.append(poseTools);

  const views = h('div', 'views');
  root.append(views);

  const GUIDE_IDLE = '関節をドラッグしてポーズを付けられます。どの面で動かしても他の面が連動します。';
  const GUIDE_POSED = 'ポーズ中: 骨の長さは変わらないので切り出し寸法はそのままです。図は「どこで曲げるか」の指示になります。';
  const renderViews = () => {
    const isCalc = root.id === 'calcOutput';
    const fitOn = isCalc && fitState.on;
    const fig = createPoseFigure(views, result.segments, {
      flesh: showFlesh,
      interactive: poseState.on || fitOn,
      mode: fitOn ? 'fit' : 'pose',
      initialJoints: fitOn ? fitState.joints : (poseState.on ? poseState.joints : null),
      onStatus: (t) => { poseHint.textContent = t; },
      onJointPick: (id) => { jointSel.value = id; },
      viewport: poseState.on ? poseState.viewport : null,
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
    // 骨格合わせ中はポーズ専用の操作(ひねり・関節リセット・ポーズ切替)を隠し、表示位置の操作だけ残す
    for (const n of [twistUp.row, twistLo.row, poseButtons]) n.hidden = fitOn;
    poseBtn.disabled = fitOn;
    if (isCalc) toggleRow.hidden = false;
    if (fitOn) {
      poseHint.textContent = '骨格合わせ中: 正面図の点を参考画像のキャラクターに合わせてください(骨の長さは自由に変わります。股を動かすと骨格全体が移動)。合わせ終わったら「キャラクターの設定」の「この骨格を体型に取り込む」を押してください。';
    } else if (poseState.on) {
      poseHint.textContent = poseState.joints ? GUIDE_POSED : GUIDE_IDLE;
    }
  };
  fleshBtn.addEventListener('click', () => {
    showFlesh = !showFlesh;
    renderCalc();
  });
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
  zoomInBtn.addEventListener('click', () => poseState.fig?.zoomIn());
  zoomOutBtn.addEventListener('click', () => poseState.fig?.zoomOut());
  viewResetBtn.addEventListener('click', () => poseState.fig?.resetView());
  renderViews();

  root.append(h('h3', null, '各部の仕上がり寸法'));
  const segTable = document.createElement('table');
  segTable.innerHTML = '<thead><tr><th>部位</th><th class="num">寸法</th></tr></thead>';
  const segBody = document.createElement('tbody');
  for (const [key, label] of SEGMENT_LABELS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td><td class="num">${result.segments[key]} cm</td>`;
    segBody.append(tr);
  }
  segTable.append(segBody);
  root.append(segTable);

  root.append(h('h3', null, 'アルミ線の切り出しリスト'));
  const cutHint = h('p', 'hint');
  cutHint.innerHTML = '「切り出し」はねじり(2本撚り)の縮みと接合ののりしろを見込んだ長さです。<strong>仕上がり寸法で切らないでください</strong>(短くて作り直しになります)。';
  root.append(cutHint);
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
  root.append(
    cutTable,
    h('p', 'summary', `切り出し合計: 約${result.totalCutCm}cm(ねじり・のりしろ込みの目安)`),
  );
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
    renderResultInto(out, computeArmature(readCalcInput()),
      { showScale: sizeMode('sizeMode') === 'height' });
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
  syncImportedNote();
  buildAdjustSliders();
  syncModeRows();
  $('saveName').value = item.name;
  showTab('calc');
  renderCalc();
}

function renderPresetList() {
  const list = $('presetList');
  const items = loadPresets(storage);
  $('saveHint').textContent = Number.isFinite(LIMITS.saveLimit)
    ? `保存は${LIMITS.saveLimit}件までです(有料版は無制限)。現在 ${items.length}/${LIMITS.saveLimit} 件`
    : `保存件数: ${items.length}件`;
  list.replaceChildren();
  if (items.length === 0) {
    list.append(h('li', 'hint', '保存データはまだありません。「芯材計算」タブから保存できます。'));
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    const date = item.savedAt ? new Date(item.savedAt).toLocaleDateString('ja-JP') : '';
    li.append(
      h('span', 'preset-name', item.name),
      h('span', 'preset-date', date),
    );
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
  $('variantLabel').textContent = VARIANT_LABEL;
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
  for (const id of ['refMove', 'refZoomIn', 'refZoomOut', 'refClear']) $(id).disabled = !has;
  $('refMove').setAttribute('aria-pressed', String(has && refImage.dragTarget === 'overlay'));
}

function calcFig() {
  return poseStates.get($('calcOutput'))?.fig;
}

function setRefImage(dataUrl) {
  calcFig()?.setOverlay(dataUrl);
  refImage.dragTarget = 'overlay';
  calcFig()?.setDragTarget('overlay');
  syncRefButtons();
}

// 骨格合わせ(キャラクターの設定): 参考画像に骨格を合わせて体型を取り込む
function initFit() {
  const sync = () => {
    $('fitToggle').setAttribute('aria-pressed', String(fitState.on));
    $('fitImport').hidden = !fitState.on;
  };
  $('fitToggle').addEventListener('click', () => {
    fitState.on = !fitState.on;
    if (fitState.on) {
      // 合わせている間はポーズ側は使わない(骨長が変わるため)。ポーズはOFFに
      const st = poseStates.get($('calcOutput'));
      if (st) st.on = false;
    }
    sync();
    renderCalc();
    if (fitState.on) $('calcOutput').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      if (refImage.overlay?.src) {
        const std = fig.standardFrame(); // { topY, soleY, hipX } 標準位置(px)
        const topY = px.top.y;
        const soleY = Math.max(px.heelL.y, px.heelR.y);
        const scale = (std.soleY - std.topY) / Math.max(1, soleY - topY);
        const ov = refImage.overlay;
        const c0 = { x: 170 + ov.t.x, y: 230 + ov.t.y }; // 現在の中心(VIEW_W/2, VIEW_H/2 基準)
        const anchor = { x: px.hip.x, y: topY };
        const c1 = { x: std.hipX + (c0.x - anchor.x) * scale, y: std.topY + (c0.y - anchor.y) * scale };
        refImage.overlay = { ...ov, s: ov.s * scale, t: { x: c1.x - 170, y: c1.y - 230 } };
      }
      fitState.on = false;
      fitState.joints = null;
      const st = poseStates.get($('calcOutput'));
      if (st) st.joints = null; // 骨長が変わるのでポーズは直立から
      sync();
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
  };
}

main();
