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
import { renderThreeViews } from './ui/diagram.js';
import { createPoseFigure } from './ui/posefig.js';
import { createPhotoFit } from './ui/photofit.js';
import { MATERIALS, materialUrl } from './affiliates.js';
import { IS_FREE, LIMITS, VARIANT_LABEL } from './build-flags.js';

const $ = (id) => document.getElementById(id);
const storage = window.localStorage;
let adjustments = { ...DEFAULT_ADJUSTMENTS };
let showFlesh = false; // 肉付けイメージの表示(両タブ共通)
const poseStates = new WeakMap(); // 出力領域ごとのポーズ状態(計算タブ/画像からタブで独立)

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

  const fleshRow = h('div', 'flesh-row');
  const fleshLabel = h('label', 'flesh-toggle');
  const fleshCb = document.createElement('input');
  fleshCb.type = 'checkbox';
  fleshCb.className = 'flesh-checkbox';
  fleshCb.checked = showFlesh;
  fleshCb.addEventListener('change', () => {
    showFlesh = fleshCb.checked;
    renderCalc();
    renderPhoto();
  });
  fleshLabel.append(fleshCb, h('span', null, '肉付けイメージを表示'));
  fleshRow.append(fleshLabel);

  // ポーズモード(三面図の連動ポーズ)。root ごとに状態を持つ
  const poseState = poseStates.get(root) ?? { on: false, joints: null, sig: null };
  poseStates.set(root, poseState);
  // 寸法(体型・サイズ)が変わったら保持していたポーズは捨てる(骨長が合わなくなるため)
  const sig = JSON.stringify(result.segments);
  if (poseState.sig !== sig) {
    poseState.joints = null;
    poseState.sig = sig;
  }
  const poseLabel = h('label', 'flesh-toggle');
  const poseCb = document.createElement('input');
  poseCb.type = 'checkbox';
  poseCb.className = 'pose-checkbox';
  poseCb.checked = poseState.on;
  poseLabel.append(poseCb, h('span', null, 'ポーズを取る(関節をドラッグ)'));
  fleshRow.append(poseLabel);
  root.append(fleshRow);

  const views = h('div', 'views');
  root.append(views);
  const poseHint = h('p', 'hint pose-hint');
  const poseReset = h('button', 'ghost', 'ポーズをリセット');
  poseReset.type = 'button';
  const poseTools = h('div', 'pose-tools');
  poseTools.append(poseHint, poseReset);
  root.append(poseTools);

  const renderViews = () => {
    if (poseState.on) {
      const fig = createPoseFigure(views, result.segments, {
        flesh: showFlesh,
        initialJoints: poseState.joints,
        onStatus: (t) => { poseHint.textContent = t; },
        onPoseChange: (joints, posed) => {
          poseState.joints = posed ? joints : null;
          poseHint.textContent = posed
            ? 'ポーズ中: 骨の長さは変わらないので切り出し寸法はそのままです。図は「どこで曲げるか」の指示になります。'
            : '関節をドラッグしてポーズを付けられます。どの面で動かしても他の面が連動します。';
        },
      });
      poseState.fig = fig;
      poseHint.textContent = poseState.joints
        ? 'ポーズ中: 骨の長さは変わらないので切り出し寸法はそのままです。図は「どこで曲げるか」の指示になります。'
        : '関節をドラッグしてポーズを付けられます。どの面で動かしても他の面が連動します。';
      poseTools.hidden = false;
    } else {
      views.replaceChildren(renderThreeViews(result, { flesh: showFlesh }));
      poseTools.hidden = true;
    }
  };
  poseCb.addEventListener('change', () => {
    poseState.on = poseCb.checked;
    renderViews();
  });
  poseReset.addEventListener('click', () => {
    poseState.fig?.reset();
    poseState.joints = null;
  });
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
  for (const id of ['scale', 'photoScale']) {
    const sel = $(id);
    for (const d of SCALE_CHOICES) {
      sel.append(new Option(`1/${d}`, String(d)));
    }
    sel.value = '8';
  }
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
  const photoByHeight = sizeMode('photoSizeMode') === 'height';
  $('photoTargetRow').hidden = photoByHeight;
  $('photoHeightRow').hidden = !photoByHeight;
  $('photoScaleRow').hidden = !photoByHeight;
}

function activeCustomRatios() {
  if (!LIMITS.adjustments || !isAdjusted(adjustments)) return null;
  return applyAdjustments(PROPORTION_PRESETS[$('preset').value].ratios, adjustments);
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
  const baseRatios = PROPORTION_PRESETS[$('preset').value].ratios;
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

// ---- 画像から ----

let photoFit = null;

function renderPhoto() {
  const joints = photoFit?.getJoints();
  if (!joints) return;
  const out = $('photoOutput');
  const errBox = $('photoError');
  errBox.hidden = true;
  try {
    const base = PROPORTION_PRESETS['female-adult'].ratios;
    const customRatios = ratiosFromJoints(joints, base);
    const byHeight = sizeMode('photoSizeMode') === 'height';
    const input = byHeight
      ? {
        modelHeightCm: Number($('photoHeight').value),
        scaleDenominator: Number($('photoScale').value),
        customRatios,
      }
      : (() => {
        const targetH = Number($('photoTarget').value);
        return { modelHeightCm: targetH, targetHeightCm: targetH, customRatios };
      })();
    renderResultInto(out, computeArmature(input), { showScale: byHeight });
  } catch (e) {
    out.hidden = true;
    errBox.hidden = false;
    errBox.textContent = e.message;
  }
}

// 画像読み込みの共通経路(ファイル選択・デバッグフックの両方から使う)
function loadPhotoImage(dataUrl) {
  return photoFit.loadImage(dataUrl).then(() => {
    $('photoRefit').hidden = false;
  }).catch((e) => {
    $('photoError').hidden = false;
    $('photoError').textContent = e.message;
  });
}

function onPhotoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadPhotoImage(reader.result);
  reader.readAsDataURL(file);
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

function main() {
  fillSelects();
  syncModeRows();
  buildAdjustSliders();
  renderMaterials();
  initSettings();

  for (const btn of document.querySelectorAll('.tabbar button')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }
  for (const radio of document.querySelectorAll('input[name=sizeMode]')) {
    radio.addEventListener('change', () => { syncModeRows(); renderCalc(); });
  }
  for (const radio of document.querySelectorAll('input[name=photoSizeMode]')) {
    radio.addEventListener('change', () => { syncModeRows(); renderPhoto(); });
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
  $('saveBtn').addEventListener('click', onSave);

  photoFit = createPhotoFit($('photoBox'), renderPhoto,
    (text) => { $('photoTapHint').textContent = text; });
  $('photoFile').addEventListener('change', (e) => onPhotoFile(e.target.files?.[0]));
  for (const id of ['photoTarget', 'photoHeight']) {
    $(id).addEventListener('input', renderPhoto);
  }
  $('photoScale').addEventListener('change', renderPhoto);
  for (const radio of document.querySelectorAll('input[name=tapAnchor]')) {
    radio.addEventListener('change', () => photoFit.setTapAnchor(radio.value));
  }
  $('photoRefit').addEventListener('click', () => {
    photoFit.rearm();
    $('photoOutput').hidden = true; // 骨格を消すのに合わせて古い寸法も消す
    $('photoError').hidden = true;
  });

  if (IS_FREE) {
    $('adjustPanel').hidden = true;
    $('adjustLocked').hidden = false;
    $('photoAdNote').hidden = false;
  }

  renderCalc();

  // スモークテスト用の開発フック(画像入力をdataURLで直接流し込む)
  window.__debug = { loadPhoto: loadPhotoImage };
}

main();
