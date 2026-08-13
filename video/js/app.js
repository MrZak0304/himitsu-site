// UI配線のみ。暗号・動画処理のロジックはここに書かない(コアは js/core, js/video)。
import { interpolateTrack, upsertKeyframe, removeKeyframe, buildPolyPoints, pointInPoly } from './core/regions.js';
import { generateKeyString, isValidKeyString } from './core/crypto.js';
import { applyFilters, regionPath } from './video/filters.js';
import { loadVideo, processCreate, processRestore } from './video/pipeline.js';
import { detectFaceTracks, faceDetectAvailable } from './video/facedetect.js';

const $ = (id) => document.getElementById(id);

const state = {
  create: {
    file: null,
    src: null, // loadVideo の結果
    tracks: [],
    selectedId: null,
    liveGeom: null, // ドラッグ中の一時ジオメトリ {id, geom}
    nextId: 1,
    beeps: [], // {id, start, end}
    selectedBeepId: null,
    nextBeepId: 1,
    beepFile: null,
    drawingPoly: null, // なげなわ描画中の生点列 [{x,y}] または null
    filter: { type: 'mosaic', size: 16 },
    format: 'B',
    busy: false,
    result: null,
  },
  restore: {
    videoFile: null,
    payloadFile: null,
    busy: false,
    result: null,
  },
};
window.appState = state; // スモークテスト用

// ---- タブ ----
$('tab-create').addEventListener('click', () => switchTab('create'));
$('tab-restore').addEventListener('click', () => switchTab('restore'));
function switchTab(name) {
  $('tab-create').classList.toggle('active', name === 'create');
  $('tab-restore').classList.toggle('active', name === 'restore');
  $('panel-create').hidden = name !== 'create';
  $('panel-restore').hidden = name !== 'restore';
}

// ---- 作成: 動画読み込み ----
$('createFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('createStatus', '動画を読み込み中…');
  try {
    state.create.src?.dispose();
    state.create.src = null;
    const src = await loadVideo(file);
    state.create.file = file;
    state.create.src = src;
    state.create.tracks = [];
    state.create.selectedId = null;
    state.create.beeps = [];
    state.create.selectedBeepId = null;
    state.create.result = null;
    $('createResult').hidden = true;
    $('createFileName').textContent =
      `${file.name}(${src.width}×${src.height}・${src.duration.toFixed(1)}秒)`;
    $('createPreviewBlock').hidden = false;
    const canvas = $('createCanvas');
    canvas.width = src.width;
    canvas.height = src.height;
    $('timeline').max = src.duration;
    $('timeline').value = 0;
    if (src.duration > 300) {
      setStatus('createStatus', '長い動画は処理に時間がかかります(プロトタイプは〜1分推奨)', 'error');
    } else {
      setStatus('createStatus', '「+ 円を追加」で隠したい場所に領域を置いてください');
    }
    renderRegionUI();
    renderBeepUI();
  } catch (err) {
    setStatus('createStatus', err.message, 'error');
  }
});

// ---- 作成: 再生・タイムライン ----
$('playBtn').addEventListener('click', () => {
  const v = state.create.src?.video;
  if (!v) return;
  if (v.paused) {
    // 読み込みは muted で行うため、再生時(ユーザー操作)に消音を解除して音声を出す
    v.muted = false;
    v.play();
    $('playBtn').textContent = '❚❚';
  } else {
    v.pause();
    $('playBtn').textContent = '▶';
  }
});
$('timeline').addEventListener('input', () => {
  const v = state.create.src?.video;
  if (!v) return;
  v.pause();
  $('playBtn').textContent = '▶';
  v.currentTime = Number($('timeline').value);
});
$('stepBack').addEventListener('click', () => stepFrame(-1));
$('stepFwd').addEventListener('click', () => stepFrame(1));
function stepFrame(dir) {
  const v = state.create.src?.video;
  if (!v) return;
  v.pause();
  $('playBtn').textContent = '▶';
  v.currentTime = Math.max(0, Math.min(v.duration - 0.001, v.currentTime + dir / 30));
  $('timeline').value = v.currentTime;
}

// ---- 作成: 領域 ----
$('addCircle').addEventListener('click', () => addRegion('circle'));
$('addEllipse').addEventListener('click', () => addRegion('ellipse'));
$('addRect').addEventListener('click', () => addRegion('rect'));
$('addPoly').addEventListener('click', () => {
  if (!state.create.src || state.create.busy) return;
  // なげなわ描画モードに入る(次のプレビュー上のドラッグで輪郭を描く)
  state.create.drawingPoly = [];
  $('polyHint').hidden = false;
  $('addPoly').classList.add('active-draw');
  setStatus('createStatus', 'プレビュー上を指でなぞって形を囲んでください。');
});
function addRegion(shape) {
  const src = state.create.src;
  if (!src) return;
  const r = Math.min(src.width, src.height) * 0.18;
  const shapeName = { circle: '円', ellipse: '楕円', rect: '四角' }[shape];
  const id = state.create.nextId++;
  const track = {
    id,
    shape,
    name: `${shapeName}${id}`,
    enabled: true,
    keyframes: [],
  };
  const geom = {
    cx: src.width / 2,
    cy: src.height / 2,
    rx: r,
    ry: shape === 'circle' ? r : r * 0.7,
  };
  upsertKeyframe(track, currentTime(), geom);
  state.create.tracks.push(track);
  state.create.selectedId = track.id;
  renderRegionUI();
}

$('deleteRegion').addEventListener('click', () => {
  const c = state.create;
  c.tracks = c.tracks.filter((t) => t.id !== c.selectedId);
  c.selectedId = c.tracks.at(-1)?.id ?? null;
  renderRegionUI();
});

// ---- 作成: 顔を自動でさがす ----
$('autoFace').addEventListener('click', async () => {
  const c = state.create;
  if (c.busy || !c.file) {
    if (!c.file) setStatus('createStatus', '先に動画を選んでください。', 'error');
    return;
  }
  if (!faceDetectAvailable()) {
    setStatus('createStatus', 'この環境では顔の自動検出を使えません。手動で領域を追加してください。', 'error');
    return;
  }
  c.busy = true;
  $('autoFace').disabled = true;
  $('exportBtn').disabled = true;
  c.src.video.pause();
  $('playBtn').textContent = '▶';
  $('createProgress').hidden = false;
  $('autoFaceStatus').hidden = false; // ボタン隣の「検出中」表示
  $('autoFacePercent').textContent = '0%';
  setStatus('createStatus', '顔をさがしています… 画面はそのままお待ちください');
  try {
    const { tracks } = await detectFaceTracks(c.file, (p) => {
      updateProgress('create', p);
      $('autoFacePercent').textContent = `${Math.round(p * 100)}%`;
    });
    if (tracks.length === 0) {
      setStatus('createStatus', '顔が見つかりませんでした。手動で領域を追加してください。', 'error');
      return;
    }
    // 検出トラックにIDを振って追加(既存領域は残す)
    for (const tr of tracks) {
      tr.id = c.nextId++;
      c.tracks.push(tr);
    }
    c.selectedId = c.tracks.at(-1).id;
    renderRegionUI();
    setStatus('createStatus',
      `${tracks.length}件の顔を検出しました。不要な顔は「モザイクをかける」のチェックを外してください。`, 'ok');
  } catch (err) {
    console.warn(err);
    setStatus('createStatus', err.message ?? String(err), 'error');
  } finally {
    c.busy = false;
    $('autoFace').disabled = false;
    $('exportBtn').disabled = false;
    $('createProgress').hidden = true;
    $('autoFaceStatus').hidden = true;
  }
});

// 選択中の領域のモザイクON/OFF(不要な顔の除外)
$('regionEnabled').addEventListener('change', () => {
  const track = selectedTrack();
  if (!track) return;
  track.enabled = $('regionEnabled').checked;
  renderRegionUI();
});

$('addKeyframe').addEventListener('click', () => {
  const track = selectedTrack();
  if (!track) return;
  const g = interpolateTrack(track, currentTime());
  upsertKeyframe(track, currentTime(), g);
  renderRegionUI();
});

function selectedTrack() {
  return state.create.tracks.find((t) => t.id === state.create.selectedId) ?? null;
}

function currentTime() {
  return state.create.src?.video.currentTime ?? 0;
}

function renderRegionUI() {
  const list = $('regionList');
  list.innerHTML = '';
  for (const track of state.create.tracks) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip'
      + (track.id === state.create.selectedId ? ' selected' : '')
      + (track.enabled === false ? ' disabled' : '');
    chip.textContent = track.name;
    chip.addEventListener('click', () => {
      state.create.selectedId = track.id;
      renderRegionUI();
    });
    list.appendChild(chip);
  }
  const track = selectedTrack();

  // 名前編集欄+モザイクON/OFF(領域選択中のみ表示)
  const nameRow = $('regionNameRow');
  const nameInput = $('regionName');
  nameRow.hidden = !track;
  if (track && document.activeElement !== nameInput) {
    nameInput.value = track.name;
  }
  if (track) $('regionEnabled').checked = track.enabled !== false;

  const kfList = $('keyframeList');
  kfList.innerHTML = '';
  if (track) {
    for (const kf of track.keyframes) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.innerHTML = `${kf.t.toFixed(2)}s<span class="x">×</span>`;
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) {
          removeKeyframe(track, kf.t);
          renderRegionUI();
        } else {
          const v = state.create.src?.video;
          if (v) v.currentTime = kf.t;
          $('timeline').value = kf.t;
        }
      });
      kfList.appendChild(chip);
    }
  }
  renderTrackLanes();
}

$('regionName').addEventListener('input', () => {
  const track = selectedTrack();
  if (!track) return;
  track.name = $('regionName').value;
  // チップ表示だけ更新(入力欄のフォーカスは保つ)
  const chips = $('regionList').children;
  const idx = state.create.tracks.indexOf(track);
  if (chips[idx]) chips[idx].textContent = track.name || '(名前なし)';
  renderTrackLanes();
});

// ---- シークバー下の位置可視化(モザイク領域・ピー音の帯) ----
function renderTrackLanes() {
  const lanes = $('trackLanes');
  const src = state.create.src;
  if (!src) { lanes.innerHTML = ''; return; }
  const dur = src.duration || 1;
  lanes.innerHTML = '';

  // 各モザイク領域を1レーンで表示(最初のキーフレーム〜最後のキーフレームを帯に)
  for (const track of state.create.tracks) {
    const lane = document.createElement('div');
    lane.className = 'track-lane';
    if (track.keyframes.length > 0) {
      const t0 = track.keyframes[0].t;
      const t1 = track.keyframes[track.keyframes.length - 1].t;
      const seg = document.createElement('div');
      seg.className = 'track-seg region' + (track.id === state.create.selectedId ? ' selected' : '');
      seg.style.left = `${(t0 / dur) * 100}%`;
      // 単一キーフレーム(=全編適用)は帯全体、複数なら区間
      seg.style.width = track.keyframes.length === 1 ? '100%' : `${((t1 - t0) / dur) * 100}%`;
      seg.title = track.name;
      seg.addEventListener('click', () => {
        state.create.selectedId = track.id;
        seekTimeline(t0);
        renderRegionUI();
      });
      lane.appendChild(seg);
    }
    const label = document.createElement('span');
    label.className = 'lane-label';
    label.textContent = track.name;
    lane.appendChild(label);
    lane.appendChild(makePlayhead(dur));
    lanes.appendChild(lane);
  }

  // ピー音は1レーンにまとめて表示
  if (state.create.beeps.length > 0) {
    const lane = document.createElement('div');
    lane.className = 'track-lane';
    for (const beep of state.create.beeps) {
      const seg = document.createElement('div');
      seg.className = 'track-seg beep' + (beep.id === state.create.selectedBeepId ? ' selected' : '');
      seg.style.left = `${(beep.start / dur) * 100}%`;
      seg.style.width = `${Math.max(0.5, ((beep.end - beep.start) / dur) * 100)}%`;
      seg.title = `ピー音 ${beep.start.toFixed(2)}〜${beep.end.toFixed(2)}s`;
      seg.addEventListener('click', () => {
        state.create.selectedBeepId = beep.id;
        seekTimeline(beep.start);
        renderBeepUI();
      });
      lane.appendChild(seg);
    }
    const label = document.createElement('span');
    label.className = 'lane-label';
    label.textContent = 'ピー音';
    lane.appendChild(label);
    lane.appendChild(makePlayhead(dur));
    lanes.appendChild(lane);
  }
}

function makePlayhead(dur) {
  const ph = document.createElement('div');
  ph.className = 'lane-playhead';
  ph.style.left = `${(currentTime() / dur) * 100}%`;
  return ph;
}

function seekTimeline(t) {
  const v = state.create.src?.video;
  if (v) v.currentTime = t;
  $('timeline').value = t;
}

// ---- 作成: ピー音(音声を隠す時間範囲) ----
$('addBeep').addEventListener('click', () => {
  const src = state.create.src;
  if (!src) return;
  const start = Math.min(currentTime(), Math.max(0, src.duration - 0.1));
  const beep = {
    id: state.create.nextBeepId++,
    start,
    end: Math.min(src.duration, start + 1),
  };
  state.create.beeps.push(beep);
  state.create.selectedBeepId = beep.id;
  renderBeepUI();
});

$('beepSetStart').addEventListener('click', () => {
  const beep = selectedBeep();
  if (!beep) return;
  beep.start = Math.min(currentTime(), beep.end - 0.05);
  renderBeepUI();
});

$('beepSetEnd').addEventListener('click', () => {
  const beep = selectedBeep();
  if (!beep) return;
  beep.end = Math.max(currentTime(), beep.start + 0.05);
  renderBeepUI();
});

$('deleteBeep').addEventListener('click', () => {
  const c = state.create;
  c.beeps = c.beeps.filter((b) => b.id !== c.selectedBeepId);
  c.selectedBeepId = c.beeps.at(-1)?.id ?? null;
  renderBeepUI();
});

$('beepFile').addEventListener('change', (e) => {
  state.create.beepFile = e.target.files[0] ?? null;
  $('beepFileName').textContent = state.create.beepFile?.name ?? '標準のピー音';
});

function selectedBeep() {
  return state.create.beeps.find((b) => b.id === state.create.selectedBeepId) ?? null;
}

function renderBeepUI() {
  const list = $('beepList');
  list.innerHTML = '';
  for (const beep of state.create.beeps) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (beep.id === state.create.selectedBeepId ? ' selected' : '');
    chip.innerHTML = `${beep.start.toFixed(2)}〜${beep.end.toFixed(2)}s<span class="x">×</span>`;
    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) {
        state.create.beeps = state.create.beeps.filter((b) => b.id !== beep.id);
        if (state.create.selectedBeepId === beep.id) state.create.selectedBeepId = null;
      } else {
        state.create.selectedBeepId = beep.id;
        const v = state.create.src?.video;
        if (v) v.currentTime = beep.start;
        $('timeline').value = beep.start;
      }
      renderBeepUI();
    });
    list.appendChild(chip);
  }
  renderTrackLanes();
}

// ---- 作成: キャンバス操作(ドラッグで移動・縁でサイズ変更) ----
const canvas = $('createCanvas');
let drag = null;
let polyDrawing = false; // なげなわを実際になぞっている最中か
canvas.addEventListener('pointerdown', (e) => {
  const src = state.create.src;
  if (!src || state.create.busy) return;
  const p = canvasPoint(e);
  // なげなわ描画モード: なぞり始め
  if (state.create.drawingPoly) {
    state.create.drawingPoly = [p];
    polyDrawing = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成イベント等では無視 */ }
    return;
  }
  const t = currentTime();
  // 上に描かれているもの(後に追加)を優先
  for (let i = state.create.tracks.length - 1; i >= 0; i--) {
    const track = state.create.tracks[i];
    const g = interpolateTrack(track, t);
    if (!g) continue;
    // 領域内外の判定値。poly は多角形の内外、矩形はチェビシェフ、他は楕円距離
    let q;
    if (track.shape === 'poly') {
      q = pointInPoly(p.x, p.y, g.poly) ? 0 : 2;
    } else if (track.shape === 'rect') {
      q = Math.max(Math.abs(p.x - g.cx) / g.rx, Math.abs(p.y - g.cy) / g.ry);
    } else {
      q = Math.hypot((p.x - g.cx) / g.rx, (p.y - g.cy) / g.ry);
    }
    if (q <= 1.2) {
      state.create.selectedId = track.id;
      drag = {
        track,
        mode: q < 0.75 ? 'move' : 'resize',
        start: p,
        g0: { ...g },
      };
      canvas.setPointerCapture(e.pointerId);
      renderRegionUI();
      return;
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  // なげなわ描画中: 点を足す
  if (state.create.drawingPoly && polyDrawing) {
    state.create.drawingPoly.push(canvasPoint(e));
    return;
  }
  if (!drag) return;
  const p = canvasPoint(e);
  const { track, mode, start, g0 } = drag;
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  let geom;
  if (mode === 'move') {
    geom = { ...g0, cx: g0.cx + dx, cy: g0.cy + dy };
    // poly は表示用の絶対頂点も一緒に平行移動する
    if (g0.poly) geom.poly = g0.poly.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
  } else if (track.shape === 'poly') {
    // poly の resize は重心からの距離比で scale を変える
    const d0 = Math.hypot(start.x - g0.cx, start.y - g0.cy) || 1;
    const d1 = Math.hypot(p.x - g0.cx, p.y - g0.cy);
    const k = Math.max(0.2, d1 / d0);
    geom = { ...g0, scale: (g0.scale ?? 1) * k };
    geom.poly = g0.poly.map((pt) => ({ x: g0.cx + (pt.x - g0.cx) * k, y: g0.cy + (pt.y - g0.cy) * k }));
  } else {
    const rx = Math.max(10, Math.abs(p.x - g0.cx));
    const ry = Math.max(10, Math.abs(p.y - g0.cy));
    geom = track.shape === 'circle'
      ? { ...g0, rx: Math.max(rx, ry), ry: Math.max(rx, ry) }
      : { ...g0, rx, ry };
  }
  state.create.liveGeom = { id: track.id, geom };
});
canvas.addEventListener('pointerup', (e) => {
  // なげなわ描画完了: トラックを作る
  if (state.create.drawingPoly) {
    finishPolyDraw(state.create.drawingPoly);
    state.create.drawingPoly = null;
    polyDrawing = false;
    $('polyHint').hidden = true;
    $('addPoly').classList.remove('active-draw');
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* 無視 */ }
    return;
  }
  if (!drag) return;
  const live = state.create.liveGeom;
  if (live && live.id === drag.track.id) {
    upsertKeyframe(drag.track, currentTime(), live.geom);
    renderRegionUI();
  }
  state.create.liveGeom = null;
  drag = null;
});

function finishPolyDraw(rawPoints) {
  const built = buildPolyPoints(rawPoints);
  if (!built) {
    setStatus('createStatus', '形が小さすぎます。もう一度大きく囲んでください。', 'error');
    return;
  }
  const id = state.create.nextId++;
  const track = {
    id,
    shape: 'poly',
    name: `自由形状${id}`,
    enabled: true,
    points: built.points,
    keyframes: [],
  };
  upsertKeyframe(track, currentTime(), { cx: built.center.cx, cy: built.center.cy, scale: 1 });
  state.create.tracks.push(track);
  state.create.selectedId = id;
  renderRegionUI();
  setStatus('createStatus', '自由形状を追加しました。ドラッグで移動・時間を進めて追従できます。', 'ok');
}
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  };
}

// ---- 作成: プレビュー描画ループ ----
function drawPreview() {
  requestAnimationFrame(drawPreview);
  const src = state.create.src;
  if (!src || $('panel-create').hidden) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src.video, 0, 0, canvas.width, canvas.height);
  const t = src.video.currentTime;

  const geoms = [];
  for (const track of state.create.tracks) {
    const live = state.create.liveGeom;
    const g0 = live && live.id === track.id ? live.geom : interpolateTrack(track, t);
    if (g0) geoms.push({ track, g: { ...g0, shape: track.shape } });
  }
  // モザイクは有効な領域のみ焼き込む(無効=不要な顔は除外)
  applyFilters(ctx, canvas, geoms.filter((x) => x.track.enabled !== false).map((x) => x.g), state.create.filter);

  // 領域の枠線(選択中=アクセント色、無効=赤の点線でスキップを明示)
  for (const { track, g } of geoms) {
    ctx.save();
    ctx.lineWidth = Math.max(1.5, canvas.width / 400);
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = track.enabled === false
      ? 'rgba(224, 85, 85, 0.8)'
      : (track.id === state.create.selectedId ? '#f0a935' : 'rgba(255,255,255,0.55)');
    regionPath(ctx, g);
    ctx.stroke();
    ctx.restore();
  }

  // なげなわ描画中のなぞり線を表示
  const dp = state.create.drawingPoly;
  if (dp && dp.length > 1) {
    ctx.save();
    ctx.lineWidth = Math.max(2, canvas.width / 300);
    ctx.strokeStyle = '#f0a935';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(dp[0].x, dp[0].y);
    for (let i = 1; i < dp.length; i++) ctx.lineTo(dp[i].x, dp[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // タイムライン同期
  if (!src.video.paused) $('timeline').value = t;
  $('timeLabel').textContent = `${t.toFixed(2)} / ${src.duration.toFixed(2)}`;
  if (src.video.ended) $('playBtn').textContent = '▶';

  // レーンの再生ヘッド位置を更新(DOM再構築せず位置だけ)
  const dur = src.duration || 1;
  for (const ph of $('trackLanes').querySelectorAll('.lane-playhead')) {
    ph.style.left = `${(t / dur) * 100}%`;
  }
}
requestAnimationFrame(drawPreview);

// ---- 作成: フィルター/形式コントロール ----
for (const radio of document.querySelectorAll('input[name="filterType"]')) {
  radio.addEventListener('change', () => {
    state.create.filter.type = radio.value;
    const isMosaic = radio.value === 'mosaic';
    $('filterSizeLabel').textContent = isMosaic ? '粗さ' : '強さ';
    $('filterSize').min = 4;
    $('filterSize').max = isMosaic ? 64 : 40;
    $('filterSize').value = isMosaic ? 16 : 12;
    state.create.filter.size = Number($('filterSize').value);
    $('filterSizeValue').textContent = $('filterSize').value;
  });
}
$('filterSize').addEventListener('input', () => {
  state.create.filter.size = Number($('filterSize').value);
  $('filterSizeValue').textContent = $('filterSize').value;
});
for (const radio of document.querySelectorAll('input[name="format"]')) {
  radio.addEventListener('change', () => { state.create.format = radio.value; });
}

// ---- 作成: 書き出し ----
$('exportBtn').addEventListener('click', async () => {
  const c = state.create;
  if (c.busy) return;
  if (!c.file || !c.src) return setStatus('createStatus', '先に動画を選んでください。', 'error');
  if (c.tracks.length === 0) return setStatus('createStatus', '隠したい領域を追加してください。', 'error');
  // モザイクをかける(有効な)領域だけを書き出し対象にする
  const activeTracks = c.tracks.filter((t) => t.enabled !== false);
  if (activeTracks.length === 0) return setStatus('createStatus', 'モザイクをかける領域がありません(すべて除外されています)。', 'error');

  c.busy = true;
  c.src.video.pause();
  $('playBtn').textContent = '▶';
  $('exportBtn').disabled = true;
  $('createProgress').hidden = false;
  $('createResult').hidden = true;
  setStatus('createStatus', '処理中… 画面はそのままお待ちください');
  try {
    const keyString = generateKeyString();
    const { sharedBytes, payload, hasAudio } = await processCreate({
      file: c.file,
      tracks: activeTracks,
      filter: c.filter,
      format: c.format,
      keyString,
      beeps: c.beeps.map((b) => ({ start: b.start, end: b.end })),
      beepFile: c.beepFile,
      onProgress: (p) => updateProgress('create', p),
    });
    const base = c.file.name.replace(/\.[^.]+$/, '') || 'video';
    const sharedBlob = new Blob([sharedBytes], { type: 'video/mp4' });
    const payloadBlob = c.format === 'A'
      ? new Blob([payload], { type: 'application/octet-stream' })
      : null;
    c.result = { sharedBlob, payloadBlob, key: keyString };

    $('keyOutput').textContent = keyString;
    const links = $('downloadLinks');
    links.innerHTML = '';
    links.appendChild(downloadLink(sharedBlob, `${base}_mosaic.mp4`, 'モザイク動画を保存'));
    if (payloadBlob) {
      links.appendChild(downloadLink(payloadBlob, `${base}_restore.ezmv`, '復元ファイルを保存'));
    }
    $('resultNote').textContent =
      (c.format === 'A'
        ? '動画と復元ファイルの2点を相手に渡し、解除キーは別の方法で伝えてください。※復元ファイルはLINEでは送れません(メール・Slack等で)。'
        : '復元データは動画に埋め込み済みです。SNSにアップすると埋め込みが消えるため、ファイルのまま(AirDrop等)で渡してください。')
      + (hasAudio ? '' : ' ※音声は引き継げませんでした(無音になります)。');
    $('createResult').hidden = false;
    setStatus('createStatus', '書き出しが完了しました。', 'ok');
  } catch (err) {
    console.warn(err); // 利用者向けメッセージは status に出す(想定内エラーを含むため error にしない)
    setStatus('createStatus', err.message ?? String(err), 'error');
  } finally {
    c.busy = false;
    $('exportBtn').disabled = false;
    $('createProgress').hidden = true;
  }
});

$('copyKey').addEventListener('click', async () => {
  const key = state.create.result?.key;
  if (!key) return;
  try {
    await navigator.clipboard.writeText(key);
    setStatus('createStatus', '解除キーをコピーしました。', 'ok');
  } catch {
    setStatus('createStatus', 'コピーできませんでした。手動で控えてください。', 'error');
  }
});

// ---- 復元 ----
$('restoreVideoFile').addEventListener('change', (e) => {
  state.restore.videoFile = e.target.files[0] ?? null;
  $('restoreVideoName').textContent = state.restore.videoFile?.name ?? '未選択';
});
$('restorePayloadFile').addEventListener('change', (e) => {
  state.restore.payloadFile = e.target.files[0] ?? null;
  $('restorePayloadName').textContent = state.restore.payloadFile?.name ?? '未選択(一体型なら不要)';
});

$('restoreBtn').addEventListener('click', async () => {
  const r = state.restore;
  if (r.busy) return;
  if (!r.videoFile) return setStatus('restoreStatus', '動画ファイルを選んでください。', 'error');
  const keyString = $('restoreKey').value;
  if (!isValidKeyString(keyString)) {
    return setStatus('restoreStatus', '解除キーの形式が正しくありません(XXXX-XXXX-XXXX-XXXX)。', 'error');
  }
  r.busy = true;
  $('restoreBtn').disabled = true;
  $('restoreProgress').hidden = false;
  $('restoreResult').hidden = true;
  setStatus('restoreStatus', '復元中… 画面はそのままお待ちください');
  try {
    const payloadBytes = r.payloadFile
      ? new Uint8Array(await r.payloadFile.arrayBuffer())
      : null;
    const { restoredBytes } = await processRestore({
      videoFile: r.videoFile,
      payloadBytes,
      keyString,
      onProgress: (p) => updateProgress('restore', p),
    });
    const blob = new Blob([restoredBytes], { type: 'video/mp4' });
    r.result = { blob };
    const url = URL.createObjectURL(blob);
    $('restoreResultVideo').src = url;
    const dl = $('restoreDownload');
    dl.href = url;
    dl.download = (r.videoFile.name.replace(/\.[^.]+$/, '') || 'video') + '_restored.mp4';
    $('restoreResult').hidden = false;
    setStatus('restoreStatus', '復元が完了しました。', 'ok');
  } catch (err) {
    console.warn(err); // 同上
    setStatus('restoreStatus', err.message ?? String(err), 'error');
  } finally {
    r.busy = false;
    $('restoreBtn').disabled = false;
    $('restoreProgress').hidden = true;
  }
});

// ---- チュートリアル(初回表示+「使い方」から再表示) ----
const TUTORIAL_KEY = 'kdms_tutorial_done';
const TUTORIAL_STEPS = [
  {
    title: '① 動画を選ぶ',
    body: '「動画を選ぶ」からスマホで撮った動画を読み込みます(MP4推奨)。',
  },
  {
    title: '② 隠す場所に領域を置く',
    body: '「顔を自動でさがす」で顔を自動検出(不要な顔はチェックを外して除外)。手動は「+ 円/四角」でドラッグ移動・縁で大きさ変更。「+ 自由形状」ならプレビューを指でなぞって好きな形に囲めます。複数置くときは名前を付けると便利です。',
  },
  {
    title: '③ 動きに合わせる',
    body: '下のバーで時間を進めて領域をドラッグし直すと、その時刻の位置が記録され、間の動きは自動でつながります。◀|・|▶ で1コマずつ動かせます。',
  },
  {
    title: '④ 音声を隠すには',
    body: '「+ ピー音を追加」で時間範囲を指定すると、その間の音声がピー音になります(音はお好みの音声ファイルに変更可能)。復元すると元の音声に戻ります。',
  },
  {
    title: '⑤ 暗号化して書き出し',
    body: '復元データ入りのモザイク動画(一体型)と解除キーができます。動画はファイルのまま(AirDrop・Slack・メール等)相手に渡し、キーは別の方法で伝えます。※SNSやLINEに「動画として」投稿すると復元データが消え、見せる専用になります。',
  },
  {
    title: '⑥ 元に戻すには',
    body: '受け取った人は「復元」タブで、動画と解除キーを入れると元の動画に戻せます(分割型で作った場合は復元ファイルも指定)。',
  },
];
let tutorialIndex = 0;

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialIndex];
  $('tutorialTitle').textContent = step.title;
  $('tutorialBody').textContent = step.body;
  $('tutorialPrev').disabled = tutorialIndex === 0;
  $('tutorialNext').textContent = tutorialIndex === TUTORIAL_STEPS.length - 1 ? 'はじめる' : '次へ →';
  $('tutorialDots').innerHTML = TUTORIAL_STEPS
    .map((_, i) => `<i${i === tutorialIndex ? ' class="on"' : ''}></i>`)
    .join('');
}

function openTutorial() {
  tutorialIndex = 0;
  $('tutorial').hidden = false;
  renderTutorialStep();
}

function closeTutorial() {
  $('tutorial').hidden = true;
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch { /* プライベートブラウズ等では保存できなくてもよい */ }
}

$('helpBtn').addEventListener('click', openTutorial);
$('tutorialClose').addEventListener('click', closeTutorial);
$('tutorialPrev').addEventListener('click', () => {
  if (tutorialIndex > 0) {
    tutorialIndex--;
    renderTutorialStep();
  }
});
$('tutorialNext').addEventListener('click', () => {
  if (tutorialIndex < TUTORIAL_STEPS.length - 1) {
    tutorialIndex++;
    renderTutorialStep();
  } else {
    closeTutorial();
  }
});
try {
  if (!localStorage.getItem(TUTORIAL_KEY)) openTutorial();
} catch { /* 同上 */ }

// ---- 共通ヘルパー ----
function setStatus(id, message, kind) {
  const el = $(id);
  el.textContent = message;
  el.className = 'status' + (kind ? ` ${kind}` : '');
}

function updateProgress(prefix, p) {
  const percent = Math.round(p * 100);
  $(`${prefix}ProgressBar`).style.width = `${percent}%`;
  $(`${prefix}ProgressLabel`).textContent = `${percent}%`;
}

function downloadLink(blob, filename, label) {
  const a = document.createElement('a');
  a.className = 'btn';
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.textContent = label;
  return a;
}
