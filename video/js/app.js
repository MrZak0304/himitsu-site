// UI配線のみ。暗号・動画処理のロジックはここに書かない(コアは js/core, js/video)。
import { interpolateTrack, upsertKeyframe, removeKeyframe } from './core/regions.js';
import { generateKeyString, isValidKeyString } from './core/crypto.js';
import { applyFilters, regionPath } from './video/filters.js';
import { loadVideo, processCreate, processRestore } from './video/pipeline.js';

const $ = (id) => document.getElementById(id);

const state = {
  create: {
    file: null,
    src: null, // loadVideo の結果
    tracks: [],
    selectedId: null,
    liveGeom: null, // ドラッグ中の一時ジオメトリ {id, geom}
    nextId: 1,
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
  } catch (err) {
    setStatus('createStatus', err.message, 'error');
  }
});

// ---- 作成: 再生・タイムライン ----
$('playBtn').addEventListener('click', () => {
  const v = state.create.src?.video;
  if (!v) return;
  if (v.paused) {
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
function addRegion(shape) {
  const src = state.create.src;
  if (!src) return;
  const r = Math.min(src.width, src.height) * 0.18;
  const track = {
    id: state.create.nextId++,
    shape,
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
    chip.className = 'chip' + (track.id === state.create.selectedId ? ' selected' : '');
    chip.textContent = `${{ circle: '円', ellipse: '楕円', rect: '四角' }[track.shape]} ${track.id}`;
    chip.addEventListener('click', () => {
      state.create.selectedId = track.id;
      renderRegionUI();
    });
    list.appendChild(chip);
  }
  const kfList = $('keyframeList');
  kfList.innerHTML = '';
  const track = selectedTrack();
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
}

// ---- 作成: キャンバス操作(ドラッグで移動・縁でサイズ変更) ----
const canvas = $('createCanvas');
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const src = state.create.src;
  if (!src || state.create.busy) return;
  const p = canvasPoint(e);
  const t = currentTime();
  // 上に描かれているもの(後に追加)を優先
  for (let i = state.create.tracks.length - 1; i >= 0; i--) {
    const track = state.create.tracks[i];
    const g = interpolateTrack(track, t);
    if (!g) continue;
    // 領域内外の判定値(1.0 が境界)。矩形はチェビシェフ距離で判定
    const q = track.shape === 'rect'
      ? Math.max(Math.abs(p.x - g.cx) / g.rx, Math.abs(p.y - g.cy) / g.ry)
      : Math.hypot((p.x - g.cx) / g.rx, (p.y - g.cy) / g.ry);
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
  if (!drag) return;
  const p = canvasPoint(e);
  const { track, mode, start, g0 } = drag;
  let geom;
  if (mode === 'move') {
    geom = { ...g0, cx: g0.cx + (p.x - start.x), cy: g0.cy + (p.y - start.y) };
  } else {
    const rx = Math.max(10, Math.abs(p.x - g0.cx));
    const ry = Math.max(10, Math.abs(p.y - g0.cy));
    geom = track.shape === 'circle'
      ? { ...g0, rx: Math.max(rx, ry), ry: Math.max(rx, ry) }
      : { ...g0, rx, ry };
  }
  state.create.liveGeom = { id: track.id, geom };
});
canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  const live = state.create.liveGeom;
  if (live && live.id === drag.track.id) {
    upsertKeyframe(drag.track, currentTime(), live.geom);
    renderRegionUI();
  }
  state.create.liveGeom = null;
  drag = null;
});
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
  applyFilters(ctx, canvas, geoms.map((x) => x.g), state.create.filter);

  // 領域の枠線(選択中はアクセント色)
  for (const { track, g } of geoms) {
    ctx.save();
    ctx.lineWidth = Math.max(1.5, canvas.width / 400);
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = track.id === state.create.selectedId ? '#f0a935' : 'rgba(255,255,255,0.55)';
    regionPath(ctx, g);
    ctx.stroke();
    ctx.restore();
  }

  // タイムライン同期
  if (!src.video.paused) $('timeline').value = t;
  $('timeLabel').textContent = `${t.toFixed(2)} / ${src.duration.toFixed(2)}`;
  if (src.video.ended) $('playBtn').textContent = '▶';
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
      tracks: c.tracks,
      filter: c.filter,
      format: c.format,
      keyString,
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
  $('restorePayloadName').textContent = state.restore.payloadFile?.name ?? '未選択(B形式なら不要)';
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
    body: '「+ 円を追加」で領域を追加。ドラッグで移動、縁をつまむと大きさを変えられます。',
  },
  {
    title: '③ 動きに合わせる',
    body: '下のバーで時間を進めて領域をドラッグし直すと、その時刻の位置が記録され、間の動きは自動でつながります。◀|・|▶ で1コマずつ動かせます。',
  },
  {
    title: '④ 暗号化して書き出し',
    body: '復元データ入りのモザイク動画と解除キーができます。動画はファイルのまま(AirDrop・Slack・メール等)相手に渡し、キーは別の方法で伝えます。※SNSやLINEに「動画として」投稿すると復元データが消え、見せる専用になります。',
  },
  {
    title: '⑤ 元に戻すには',
    body: '受け取った人は「復元」タブで、動画と解除キーを入れると元の動画に戻せます(A形式で作った場合は復元ファイルも指定)。',
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
