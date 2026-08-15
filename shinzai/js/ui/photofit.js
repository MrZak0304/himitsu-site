// js/ui/photofit.js — 画像から骨格: テンプレート骨格を画像に重ね、関節をドラッグで合わせる
// 座標→比率の変換は js/core/skeleton2d.js(ピュア)に委譲し、ここはドラッグUIのみ。
// 画像は端末内でのみ扱い、外部送信・保存はしない(不変条件)。

import { PROPORTION_PRESETS } from '../core/proportions.js';

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
    // 骨盤: 股関節は腰の左右(骨格模型と同じ)。脚はそこからほぼ垂直に下りる
    hipL: { x: -hipHalf, y: ratios.hipTop },
    hipR: { x: hipHalf, y: ratios.hipTop },
    kneeL: { x: -hipHalf * 0.85, y: kneeY },
    kneeR: { x: hipHalf * 0.85, y: kneeY },
    ankleL: { x: -hipHalf * 0.8, y: ankleY },
    ankleR: { x: hipHalf * 0.8, y: ankleY },
    sole: { x: 0, y: 1 },
  };
}

const BONES = [
  ['top', 'chin'], ['chin', 'hip'],
  ['shoulderL', 'shoulderR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hipL', 'hipR'], // 腰線(骨盤)
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
  ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
];

const JOINT_LABELS = {
  top: '頭頂', chin: 'あご', shoulderL: '肩(左)', shoulderR: '肩(右)',
  elbowL: 'ヒジ(左)', elbowR: 'ヒジ(右)', wristL: '手首(左)', wristR: '手首(右)',
  hip: '股', hipL: '腰(左の股関節)', hipR: '腰(右の股関節)',
  kneeL: 'ヒザ(左)', kneeR: 'ヒザ(右)', ankleL: 'くるぶし(左)', ankleR: 'くるぶし(右)',
  sole: '足裏',
};

// 部位別の色分け(どの点をどこに置くか分かりやすく。凡例は画面側に表示)
const JOINT_GROUP = {
  top: 'torso', chin: 'torso', hip: 'torso', hipL: 'torso', hipR: 'torso', sole: 'torso',
  shoulderL: 'arm', shoulderR: 'arm', elbowL: 'arm', elbowR: 'arm',
  wristL: 'arm', wristR: 'arm',
  kneeL: 'leg', kneeR: 'leg', ankleL: 'leg', ankleR: 'leg',
};

// container: 画像+SVGオーバーレイを入れる要素 / onChange: 関節が動くたび joints(px) を通知
// onStatus: 操作ガイド文の通知(2タップフィットの進行表示)
export function createPhotoFit(container, onChange, onStatus = () => {}) {
  let joints = null; // {id: {x,y}} px(表示座標)
  let svg = null;
  let tapTop = null; // 2タップフィット: 1回目(頭頂)のタップ位置
  // 2回目のタップの基準。足先が描かれていないイラスト向けに「腰(股)」も選べる
  // (2026-08-14 PDフィードバック第3弾)。hip のときは 頭頂〜股=全高の半分 の比率則から全身を逆算する。
  let tapAnchor = 'sole'; // 'sole' | 'hip'
  // 2タップフィットの受付状態。フィット完了後は false にして、微調整中の誤タップで
  // 頭頂指定に戻らないようにする(2026-08-14 PDフィードバック第4弾)。再開は rearm()。
  let armed = true;
  // 骨格は頭頂→足先/腰の指定が済むまで表示しない(2026-08-15 PDフィードバック第6弾:
  // デフォルト配置の点がタップの邪魔になるため)。
  let fitted = false;

  const anchorLabel = () => (tapAnchor === 'hip' ? '腰(股)' : '足先');
  const startGuide = () =>
    `画像の頭頂をタップしてください(1回目=頭頂 → 2回目=${anchorLabel()}。骨格はそのあとに表示されます)。`;
  const tapGuide = () =>
    `骨格がずれているときは、画像を直接タップ: 1回目=頭頂 → 2回目=${anchorLabel()} で骨格全体がその範囲に合います。細かい位置は点をドラッグ。`;

  function emit() {
    if (joints && fitted) onChange({ ...joints });
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
      line.setAttribute('class', `g-${JOINT_GROUP[b] ?? 'torso'}`);
      svg.append(line);
    }
    for (const id of Object.keys(joints)) {
      // 見た目の点(小)+タッチ用の当たり判定(大)の2枚重ね(スマホで動かしやすく)
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.dataset.joint = id;
      dot.setAttribute('class', `dot g-${JOINT_GROUP[id]}`);
      dot.setAttribute('r', 8);
      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.dataset.joint = id;
      hit.setAttribute('class', 'hit');
      hit.setAttribute('r', 18);
      hit.append(titleEl(JOINT_LABELS[id]));
      hit.addEventListener('pointerdown', (ev) => startDrag(ev, id));
      svg.append(dot, hit);
    }
    // 2タップフィット: 関節以外の場所のタップで頭頂→足先を指定して骨格全体を合わせる
    svg.addEventListener('pointerdown', onCanvasTap);
    // ドラッグ中にページがスクロールしないよう、オーバーレイ上のタッチは常に既定動作を止める
    svg.addEventListener('touchmove', (ev) => ev.preventDefault(), { passive: false });
    redrawBones();
    return svg;
  }

  function onCanvasTap(ev) {
    if (ev.target.dataset?.joint) return; // 関節のドラッグはそちらで処理
    if (!armed) {
      onStatus('位置合わせのタップは完了しています。やり直すときは「タップで合わせ直す」を押してください。');
      return;
    }
    const p = svgPoint(ev);
    if (!tapTop) {
      tapTop = p;
      drawTapMarker(p);
      onStatus(`頭頂を指定しました。次に${anchorLabel()}をタップしてください。`);
      return;
    }
    clearTapMarker();
    if (p.y - tapTop.y < 20) {
      tapTop = null;
      onStatus(`${anchorLabel()}は頭頂より下をタップしてください。もう一度、頭頂からやり直せます。`);
      return;
    }
    const base = PROPORTION_PRESETS['female-adult'].ratios;
    const span = p.y - tapTop.y;
    // 腰(股)基準なら 頭頂〜股=全高×hipTop から全身の高さを逆算(脚は画面外でも比率で補完される)
    const figH = tapAnchor === 'hip' ? span / base.hipTop : span;
    const vb = svg.viewBox.baseVal;
    layoutTemplate(vb.width, vb.height, {
      figTop: tapTop.y,
      figH,
      cx: (tapTop.x + p.x) / 2,
    });
    tapTop = null;
    armed = false; // 以後のタップは無効。微調整はドラッグ、やり直しは rearm()
    fitted = true;
    svg.classList.remove('unfitted'); // 指定完了 → 骨格を表示
    redrawBones();
    onStatus('骨格を合わせました。細かい位置は点をドラッグで調整してください。');
    emit();
  }

  function setTapAnchor(anchor) {
    tapAnchor = anchor === 'hip' ? 'hip' : 'sole';
    tapTop = null;
    armed = true; // 基準を変えた=合わせ直したいはず
    if (svg) clearTapMarker();
    if (joints) onStatus(fitted ? tapGuide() : startGuide());
  }

  // 「タップで合わせ直す」: 骨格をいったん消して(2026-08-15 PDフィードバック第7弾)、
  // 2タップフィットを最初からやり直す
  function rearm() {
    armed = true;
    tapTop = null;
    fitted = false;
    if (svg) {
      clearTapMarker();
      svg.classList.add('unfitted');
    }
    onStatus(startGuide());
  }

  function drawTapMarker(p) {
    const m = document.createElementNS(SVG_NS, 'circle');
    m.setAttribute('class', 'tap-marker');
    m.setAttribute('cx', p.x);
    m.setAttribute('cy', p.y);
    m.setAttribute('r', 6);
    svg.append(m);
  }

  function clearTapMarker() {
    for (const m of svg.querySelectorAll('.tap-marker')) m.remove();
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

  // 関節を動かす。骨盤は常に連結を保つ(2026-08-15 PDフィードバック第10弾):
  //   股(中心)を動かす → 骨盤の左右端と両脚も一緒に平行移動
  //   骨盤の端を動かす → 股(中心)はつねに左右端の中点
  const PELVIS_FOLLOWERS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];
  function moveJoint(id, p) {
    if (id === 'hip') {
      const dx = p.x - joints.hip.x;
      const dy = p.y - joints.hip.y;
      for (const f of PELVIS_FOLLOWERS) {
        if (joints[f]) joints[f] = { x: joints[f].x + dx, y: joints[f].y + dy };
      }
      joints.hip = p;
      return;
    }
    joints[id] = p;
    if ((id === 'hipL' || id === 'hipR') && joints.hipL && joints.hipR) {
      joints.hip = {
        x: (joints.hipL.x + joints.hipR.x) / 2,
        y: (joints.hipL.y + joints.hipR.y) / 2,
      };
    }
  }

  function startDrag(ev, id) {
    ev.preventDefault();
    ev.stopPropagation(); // 2タップフィットのタップ扱いにしない
    // いま動かしている点が何か分かるように表示する
    onStatus(`「${JOINT_LABELS[id]}」を動かしています。キャラの${JOINT_LABELS[id]}の位置に合わせてください。`);
    const pointerId = ev.pointerId;
    try {
      ev.currentTarget.setPointerCapture(pointerId);
    } catch { /* 一部ブラウザでは失敗するが window 監視で継続できる */ }
    // 追跡は window で行う(点の外へ速く動かしても・キャプチャが効かなくても外れない)
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      moveJoint(id, svgPoint(e));
      redrawBones();
    };
    const up = (e) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      emit();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // dataUrl の画像を表示してテンプレート骨格を重ねる
  function loadImage(dataUrl) {
    return new Promise((resolvePromise, rejectPromise) => {
      const img = new Image();
      img.onload = () => {
        container.replaceChildren();
        // 表示サイズ: 幅は親要素、高さは画面の約60%に収める(縦長の大きい画像でも
        // スクロールなしで全身が見えるように自動縮尺。2026-08-15 PDフィードバック第10弾)
        // ※ container 自身は空のとき display:none なので親の幅を測る
        const maxW = Math.min(420, container.parentElement?.clientWidth || 360);
        const maxH = Math.max(240, Math.min(640, (window.innerHeight || 800) * 0.6));
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        img.className = 'photofit-image';
        container.style.width = `${w}px`;
        container.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        container.append(img);
        tapTop = null;
        armed = true;
        fitted = false;
        layoutTemplate(w, h); // 位置は仮。2タップ完了までは非表示のまま
        container.append(buildOverlay(w, h));
        svg.classList.add('unfitted');
        onStatus(startGuide());
        resolvePromise();
      };
      img.onerror = () => rejectPromise(new Error('画像を読み込めませんでした'));
      img.src = dataUrl;
    });
  }

  return {
    loadImage,
    setTapAnchor,
    rearm,
    getJoints: () => (joints && fitted ? { ...joints } : null),
  };
}
