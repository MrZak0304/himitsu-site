// js/ui/posefig.js — 三面図の統一レンダラー(通常表示・ポーズモード共通)。
// 3D関節(js/core/pose3d.js)を正面・左側面・右側面に投影して描く。
//   ・骨格(芯)は関節を結ぶ線+首/手首/足首の接続しろ+頭・手・足の参考輪郭
//   ・肉付けシルエットも関節位置から描く(胴は背骨の局所座標系で定義し、ポーズに追従)
//     → ポーズON/OFFで見た目が変わらない(2026-08-15 PDフィードバック第12弾)
//   ・interactive のとき関節をドラッグでき、どの面で動かしても他の面が連動する
//   ・寸法注記は直立(未ポーズ)のときだけ表示

import {
  restPose, boneLengths, dragJoint, resetJoint, twistUpper, twistLower, project, unproject, isPosed, neckStubEnd,
  BONES, FOOT_BONES, DRAGGABLE, JOINT_LABELS,
} from '../core/pose3d.js';
import { dimLineV, dimLineH, geometry, VIEW_W, VIEW_H } from './diagram.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWS = [['front', '正面'], ['side-left', '左側面'], ['side-right', '右側面']];
// 体型合わせモードで追加・言い換えする関節名
const FIT_LABELS = { top: '頭頂(上下で頭の大きさ)', neck: 'あご', hip: '股(ロック解除中は骨格全体、ロック中は骨盤だけ移動)', spineTop: '首のつけ根(頭・首もついてくる)' };
const POSE_LABELS = { hip: '股(骨格全体を移動)' };

function el(name, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}
const fmt = (n) => Math.round(n * 100) / 100;

// container: 三面図を入れる要素 / seg: computeArmature().segments
// opts: { flesh, interactive, initialJoints, viewport, onStatus, onPoseChange, onJointPick, onViewportChange }
// viewport: 表示位置・倍率 { s, t: { front:{x,y}, 'side-left':{x,y}, 'side-right':{x,y} } }
//   (ポーズで図からはみ出すときに見やすい位置へ調整できる。2026-08-15 PD要望)
// opts.mode: 'pose'(既定。骨の長さ固定・FK)| 'fit'(体型合わせ: 正面図の関節を自由に動かして参考画像に合わせる。
//   骨の長さは変わる。取り込み用に getFrontJointsPx() で正面投影の関節位置を返す)
export function createPoseFigure(container, seg, opts = {}) {
  const interactive = opts.interactive !== false;
  const fitMode = opts.mode === 'fit';
  // 骨格合わせの位置ロック(第25弾FB): ロック中は股ドラッグ=骨盤だけ移動(骨格全体は動かない)
  let fitLocked = !!opts.fitLocked;
  // 骨格合わせで腕・脚の関節を動かすときの既定=骨の長さを保って回す(持ち上げる)。長さを変えるのは fitFree=true のときだけ(第45弾FB)
  let fitFree = !!opts.fitFree;
  const FIT_ROTATE = new Set(['elbowL', 'elbowR', 'wristL', 'wristR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR']);
  const FIT_DESC = {
    elbowL: ['wristL'], elbowR: ['wristR'], wristL: [], wristR: [],
    kneeL: ['ankleL', 'toeL'], kneeR: ['ankleR', 'toeR'], ankleL: ['toeL'], ankleR: ['toeR'], toeL: [], toeR: [],
    shoulderL: ['elbowL', 'wristL'], shoulderR: ['elbowR', 'wristR'],
  };
  const viewport = opts.viewport ?? { s: 1, t: { front: { x: 0, y: 0 }, 'side-left': { x: 0, y: 0 }, 'side-right': { x: 0, y: 0 } } };
  const stages = {}; // view → <g class="stage">
  // 透かし画像(正面図の背面に半透明で重ねる。「画像から」と「芯材計算」を一体化する第1段階。第18弾FB)
  //   overlay: { src, t:{x,y}(px), s(倍率), opacity }。dragTarget='overlay' のとき背景ドラッグ/ピンチは透かしを動かす
  const overlay = opts.overlay ?? null;
  let dragTarget = opts.dragTarget ?? 'view';
  let axisLock = !!opts.axisLock; // まっすぐ動かす(ドラッグ開始時の主方向に固定。第33弾FB)
  let mirrorMove = !!opts.mirror; // 左右対称に動かす(腕・脚の反対側も同時に。第35弾FB)
  const MIRROR_PAIR = {
    shoulderL: 'shoulderR', shoulderR: 'shoulderL', elbowL: 'elbowR', elbowR: 'elbowL', wristL: 'wristR', wristR: 'wristL',
    kneeL: 'kneeR', kneeR: 'kneeL', ankleL: 'ankleR', ankleR: 'ankleL', toeL: 'toeR', toeR: 'toeL',
  };
  let bigView = !!opts.big; // 大きく表示(枠を画面高さに合わせ、はみ出す分は切る=slice。第33弾FB)
  let overlayState = overlay ? { src: overlay.src, t: { ...(overlay.t ?? { x: 0, y: 0 }) }, s: overlay.s ?? 1, opacity: overlay.opacity ?? 0.45 } : null;
  const rest = restPose(seg);
  const lengths = boneLengths(rest);
  let joints = opts.initialJoints ?? rest;
  const svgs = {};
  const g = geometry(seg);
  const k = g.k;
  // 股の描画位置。正面・右側面は左寄り(寸法注記を右に置く)、左側面は「前」が左向きなので
  // 鏡映で右寄りに置き注記は左へ(前に出した脚が枠外に出ないように)
  // 骨格の位置は全モードで同じ(第24弾FB: モードで位置が変わると取り込みのたびに参考画像とズレが累積した)。
  // 参考画像のほうを、選んだ時点で骨格の中心(hipX)に置く
  const hipX = (view) => (view === 'side-left' ? VIEW_W - g.cx : g.cx);
  const toPx = (p, view) => {
    const { u, v } = project(p, view);
    return { x: hipX(view) + u * k, y: g.hipY + v * k };
  };
  const fromPx = (px, view) => ({ u: (px.x - hipX(view)) / k, v: (px.y - g.hipY) / k });

  // 太さの基準: 肩幅と頭高×1.5の小さい方(肩幅だけ広げても頭が埋まらない)
  const unit = Math.min(seg.shoulderWidth, seg.head * 1.5) * k;
  const W = {
    arm: Math.max(4, unit * 0.3), fore: Math.max(3, unit * 0.24),
    leg: Math.max(5, unit * 0.44), shin: Math.max(4, unit * 0.32),
    neck: Math.max(3, unit * 0.24), depth: Math.max(8, unit * 0.62),
  };
  const headR = g.headR;
  // 手足の太さプロファイル: [始点の幅, 終点の幅, ふくらみの位置(0〜1), ふくらみ量](いずれも幅=直径px)
  //   もも: つけ根が太く、ヒザへ細る / すね: ふくらはぎ(上寄り)が張り、足首へ細る
  //   上腕: 肩側が太くヒジへ / 前腕: ヒジ下が張り、手首へ細る
  const LIMB_PROFILE = {
    thigh: { w0: W.leg * 1.18, w1: W.shin * 0.95, tb: 0.25, bulge: W.leg * 0.06 }, // つけ根は腰ブロックに差し込む(丸いキャップ)
    shin: { w0: W.shin * 0.9, w1: W.shin * 0.55, tb: 0.3, bulge: W.shin * 0.3 },
    upper: { w0: W.arm * 1.05, w1: W.fore * 0.92, tb: 0.35, bulge: W.arm * 0.1 },
    lower: { w0: W.fore * 0.95, w1: W.fore * 0.6, tb: 0.28, bulge: W.fore * 0.22 },
  };
  // 太さプロファイル: t(0=始点側の端, 1=終点)での幅(直径px)
  function limbWidthAt(prof, t) {
    const st = t * t * (3 - 2 * t); // smoothstep
    const g2 = Math.exp(-(((t - prof.tb) / 0.3) ** 2));
    return prof.w0 + (prof.w1 - prof.w0) * st + prof.bulge * g2;
  }
  // 2点を結ぶテーパー形(片側 N 点ずつの多角形。角は stroke-linejoin round で丸まる)
  function limbPath(pa0, pb, prof) {
    const d0 = { x: pb.x - pa0.x, y: pb.y - pa0.y };
    const L0 = Math.hypot(d0.x, d0.y);
    if (L0 < 1e-6) return '';
    const u = { x: d0.x / L0, y: d0.y / L0 };
    const ext = prof.ext0 ?? 0;
    const pa = { x: pa0.x - u.x * ext, y: pa0.y - u.y * ext };
    const L = L0 + ext;
    const n = { x: -u.y, y: u.x };
    const N = 8;
    const left = []; const right = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const w = limbWidthAt(prof, t);
      const c = { x: pa.x + u.x * L * t, y: pa.y + u.y * L * t };
      left.push({ x: c.x + n.x * w / 2, y: c.y + n.y * w / 2 });
      right.push({ x: c.x - n.x * w / 2, y: c.y - n.y * w / 2 });
    }
    // 始点側は半円のキャップ(角が骨盤・関節から飛び出さない)
    const r0 = (prof.w0 + prof.bulge * Math.exp(-((prof.tb / 0.3) ** 2))) / 2;
    const cap = [];
    for (let i = 1; i < 6; i++) {
      const th = -Math.PI / 2 + (i / 6) * Math.PI;
      cap.push({ x: pa.x + n.x * r0 * Math.sin(th) - u.x * r0 * Math.cos(th), y: pa.y + n.y * r0 * Math.sin(th) - u.y * r0 * Math.cos(th) });
    }
    const pts = [...left, ...right.reverse(), ...cap];
    return `M ${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L ')} Z`;
  }

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

  // ---- 胴の肉付け: 部位ブロック(胸・腹・腰)。デッサン人形のように部位ごとの丸いブロックにし、
  //      脚は腰ブロックに、腕は胸(肩の丸み)に差し込む(第43弾FB: 頭部・腕部・胸部・腹部・腰部・脚部の分割)
  // 角丸多角形(px)。pts は時計回りでも反時計回りでもよい
  function roundedPoly(pts, r) {
    const n = pts.length;
    let d = '';
    for (let i = 0; i < n; i++) {
      const v = pts[i]; const prev = pts[(i - 1 + n) % n]; const next = pts[(i + 1) % n];
      const lp = Math.hypot(prev.x - v.x, prev.y - v.y); const ln = Math.hypot(next.x - v.x, next.y - v.y);
      const rr = Math.min(Array.isArray(r) ? r[i] : r, lp * 0.45, ln * 0.45);
      const a = add(v, mul(norm(sub(prev, v)), rr));
      const b = add(v, mul(norm(sub(next, v)), rr));
      d += (i === 0 ? `M ${P(a)}` : ` L ${P(a)}`) + ` Q ${P(v)} ${P(b)}`;
    }
    return `${d} Z`;
  }
  // 局所座標(t: up方向, s: side方向)の台形ブロック。r は数値か [上の角, 下の角] の丸み
  function blockPath(origin, up, side, tTop, tBot, wTop, wBot, r) {
    const at = (t, s) => add(add(origin, mul(up, t)), mul(side, s));
    const rr = Array.isArray(r) ? [r[0], r[0], r[1], r[1]] : r;
    return roundedPoly([at(tTop, -wTop), at(tTop, wTop), at(tBot, wBot), at(tBot, -wBot)], rr);
  }
  // 胴の各ブロック(front / side 共通のロジック。side は奥行き W.depth を幅に使う)
  function torsoParts(view) {
    const st = toPx(joints.spineTop, view);
    const hp = toPx(joints.hip, view);
    const sl = toPx(joints.shoulderL, view);
    const sr = toPx(joints.shoulderR, view);
    const hl = toPx(joints.hipL, view);
    const hr = toPx(joints.hipR, view);
    const up = norm(sub(st, hp)); // 背骨の向き(上)
    const torsoH = Math.hypot(st.x - hp.x, st.y - hp.y);
    const thighTopHalf = (LIMB_PROFILE.thigh.w0 + LIMB_PROFILE.thigh.bulge * 0.7) / 2;
    const orient = (v, ref) => ((v.x * ref.x + v.y * ref.y) < 0 ? mul(v, -1) : v);
    if (view === 'front') {
      const spineSide = perp(up);
      // 胸: 肩線を基準(肩の傾きに追従)。上端は肩線の少し上、下端は背骨の中ほど
      // 胸の向きは背骨基準(肩関節を個別に動かしても胸は傾かない。第47弾FB「腕を動かすと胴体が連動」)。
      // 肩線からは幅(投影距離)だけ取る(ひねりで肩が前後に回ると幅が縮む)
      const shDist = Math.hypot(sr.x - sl.x, sr.y - sl.y);
      const chestSide = spineSide;
      const chestUp = up;
      const shHalf = Math.max(shDist / 2, W.neck * 1.2);
      const hipJointHalf = Math.hypot(hr.x - hl.x, hr.y - hl.y) / 2;
      const hipHalfW = hipJointHalf + thighTopHalf * 0.9; // 腰の最大半幅(もも外縁とほぼ同じ)
      const ww = Math.max(Math.min(shHalf, hipHalfW) * 0.7, W.neck * 1.3); // ウエスト半幅
      // 胸: 肩幅からウエストへ向かって細くなる(胸→腹が段にならない)
      // 胸: 首の付け根から肩へなだらかに下がる僧帽筋のライン → 肩の丸み → ウエストへ細く(第46弾FB: 肩〜首を人に近づける)
      const nk = toPx(joints.neck, view);
      const neckLen = Math.hypot(nk.x - st.x, nk.y - st.y);
      const nw = W.neck * 0.62; // 首の半幅
      const cAt = (t, s2) => add(add(st, mul(chestUp, t)), mul(chestSide, s2));
      // 肩の外縁は上腕の付け根の外縁と一致させ、丸みは上腕のキャップに任せる(肩の出っ張りをなくす。第48弾FB)
      const armHalf = LIMB_PROFILE.upper.w0 / 2;
      const shOut = shHalf + armHalf * 0.98;
      const chest = roundedPoly([
        cAt(neckLen * 0.55, -nw * 1.25), cAt(neckLen * 0.55, nw * 1.25), // 首の付け根(僧帽筋の始まり)
        cAt(armHalf * 0.6, shOut), // 肩(僧帽筋の終わり=上腕の外縁の上)
        cAt(-armHalf * 0.6, shOut),
        cAt(-torsoH * 0.52, ww * 1.15), cAt(-torsoH * 0.52, -ww * 1.15),
        cAt(-armHalf * 0.6, -shOut), cAt(armHalf * 0.6, -shOut),
      ], [nw * 0.8, nw * 0.8, armHalf * 0.9, armHalf * 0.4, ww * 0.5, ww * 0.5, armHalf * 0.4, armHalf * 0.9]);
      // 腹: 背骨基準。ウエスト幅の細いブロック(胸・腰の下に隠れる部分が多い)
      const abdomen = blockPath(hp, up, spineSide, torsoH * 0.62, torsoH * 0.12, ww * 0.98, ww, ww * 0.5);
      // 腰: 骨盤バー(股関節の線)を基準。ウエスト幅から股関節の高さの最大幅へなだらかに広がる台形
      //     (上端が急に広いと段になる。第44弾FB)。股関節を内包し、下端はもも付け根の丸みを覆う
      const pelvSide = hipJointHalf > 1e-6 ? orient(norm(sub(hr, hl)), spineSide) : spineSide;
      const pelvUp = orient(perp(pelvSide), up);
      const pelvis = roundedPoly([
        add(add(hp, mul(pelvUp, torsoH * 0.42)), mul(pelvSide, -ww * 1.02)),
        add(add(hp, mul(pelvUp, torsoH * 0.42)), mul(pelvSide, ww * 1.02)),
        add(add(hp, mul(pelvUp, torsoH * 0.02)), mul(pelvSide, hipHalfW)), // 股関節の高さで最大幅
        add(add(hp, mul(pelvUp, -thighTopHalf * 1.02)), mul(pelvSide, hipHalfW * 0.9)),
        add(add(hp, mul(pelvUp, -thighTopHalf * 1.02)), mul(pelvSide, -hipHalfW * 0.9)),
        add(add(hp, mul(pelvUp, torsoH * 0.02)), mul(pelvSide, -hipHalfW)),
      ], [ww * 0.5, ww * 0.5, thighTopHalf * 0.6, thighTopHalf * 0.7, thighTopHalf * 0.7, thighTopHalf * 0.6]);
      return { chest, abdomen, pelvis };
    }
    // 側面: 前方向 fwd に奥行き
    let fwd = perp(up);
    const want = view === 'side-right' ? 1 : -1;
    if (Math.sign(fwd.x) !== want) fwd = mul(fwd, -1);
    const d = W.depth;
    const nk2 = toPx(joints.neck, view);
    const neckLen2 = Math.hypot(nk2.x - st.x, nk2.y - st.y);
    // 側面の胸: 首の付け根から背中側へなだらかに(僧帽筋)、胸側は少し前へ
    const sAt = (t, s2) => add(add(st, mul(up, t)), mul(fwd, s2));
    const chest = roundedPoly([
      sAt(neckLen2 * 0.5, -W.neck * 0.5), sAt(neckLen2 * 0.5, W.neck * 0.45),
      sAt(W.arm * 0.05, d * 0.5), sAt(-torsoH * 0.52, d * 0.38), sAt(-torsoH * 0.52, -d * 0.36), sAt(W.arm * 0.12, -d * 0.5),
    ], [W.neck * 0.4, W.neck * 0.4, d * 0.28, d * 0.2, d * 0.2, d * 0.3]);
    const abdomen = blockPath(add(hp, mul(fwd, d * 0.02)), up, fwd, torsoH * 0.62, torsoH * 0.12, d * 0.34, d * 0.35, d * 0.2);
    const pelvis = blockPath(add(hp, mul(fwd, -d * 0.05)), up, fwd, torsoH * 0.42, -thighTopHalf * 1.02, d * 0.36, d * 0.5, [d * 0.2, d * 0.28]);
    return { chest, abdomen, pelvis };
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
  // かかと(3D, cm): 足首からすねの延長方向へ足首高さぶん下。足裏=かかと→つま先(直立で水平。第35弾FB「側面の足の角度」)
  function heel3(side) {
    const an = joints[`ankle${side}`]; const kn = joints[`knee${side}`];
    const d = { x: an.x - kn.x, y: an.y - kn.y, z: an.z - kn.z };
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    return { x: an.x + (d.x / l) * seg.ankle, y: an.y + (d.y / l) * seg.ankle, z: an.z + (d.z / l) * seg.ankle };
  }
  // 足: 足首→つま先の関節から形を決める(つま先を動かすと足の向きが変わる)
  function footShape(view, side) {
    const an = toPx(joints[`ankle${side}`], view);
    const to = toPx(joints[`toe${side}`], view);
    const kn = toPx(joints[`knee${side}`], view);
    const he = toPx(heel3(side), view);
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
    // 側面: 足裏の線(かかと→つま先。直立では水平)。かかとの後ろに少し出す
    const sv = sub(to, he); const sl = Math.hypot(sv.x, sv.y);
    const sdir = sl > 1e-6 ? mul(sv, 1 / sl) : dir;
    const heelBack = footPx * 0.3;
    return {
      kind: 'line',
      a: add(he, mul(sdir, -heelBack)),
      b: to,
      w: Math.max(4, ankPx),
    };
  }

  function buildView(view) {
    const svg = el('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: bigView && interactive ? 'xMidYMid slice' : 'xMidYMid meet',
      class: `pose-svg${opts.flesh ? ' with-flesh' : ''}${interactive ? '' : ' static'}${bigView && interactive ? ' big' : ''}`,
      role: 'img',
      'aria-label': `骨格図(${VIEWS.find((v) => v[0] === view)[1]})`,
    });
    const flesh = el('g', { class: 'flesh' });
    // 描画順: 奥の腕脚 → 胴 → 手前の腕脚 → 首・頭。側面は奥側(反対の腕脚)を先に描く
    const sides = view === 'side-right' ? ['L', 'R'] : ['R', 'L'];
    const limbs = (s) => {
      const g2 = el('g', { class: 'limbs', 'data-side': s });
      // 手足はテーパー+ふくらみのある形(直線的なカプセルだと人型に見えない。第37弾FB)
      g2.append(
        el('path', { class: `limb upper`, 'data-seg': `shoulder${s}-elbow${s}` }),
        el('circle', { class: 'joint-round', 'data-at': `elbow${s}`, r: W.fore * 0.5 }),
        el('path', { class: `limb lower`, 'data-seg': `elbow${s}-wrist${s}` }),
        el('ellipse', { class: 'hand', 'data-side': s }),
        el('path', { class: `limb thigh`, 'data-seg': `hip${s}-knee${s}` }),
        el('circle', { class: 'joint-round', 'data-at': `knee${s}`, r: W.shin * 0.5 }),
        el('path', { class: `limb shin`, 'data-seg': `knee${s}-ankle${s}` }),
        el('ellipse', { class: 'foot-e', 'data-side': s }),
        el('line', { class: 'foot-l', 'data-side': s }),
      );
      return g2;
    };
    const torsoG = el('g', { class: 'torso-parts' });
    torsoG.append(
      el('path', { class: 'torso part-abdomen' }),
      el('path', { class: 'torso part-pelvis' }),
      el('path', { class: 'torso part-chest' }),
    );
    flesh.append(limbs(sides[0]), torsoG, limbs(sides[1]));
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
    if (interactive && (!fitMode || view === 'front')) {
      // ポーズ中も股は掴める(骨格全体の平行移動。第30弾FB: 位置を直したいのに何も起きない/回転する)
      // 骨格合わせの「あご」の点は廃止(首の軸が斜めになって不自然。第31弾FB)。首は常に首のつけ根の真上
      const ids = dragIds(view);
      for (const id of ids) {
        const hit = el('circle', { class: 'pose-hit', 'data-joint': id, r: 24 });
        const t = el('title'); t.textContent = (fitMode ? FIT_LABELS[id] : POSE_LABELS[id]) ?? JOINT_LABELS[id]; hit.append(t);
        hit.addEventListener('pointerdown', (ev) => startDrag(ev, nearestJoint(view, localPoint(svg, view, ev), id) ?? id, view));
        jointsG.append(el('circle', { class: 'pose-dot', 'data-joint': id, r: 6 }), hit);
      }
      svg.addEventListener('touchmove', (ev) => ev.preventDefault(), { passive: false });
    }
    if (fitMode && view !== 'front') svg.classList.add('fit-side');
    const stage = el('g', { class: 'stage' });
    if (view === 'front') {
      const img = el('image', { class: 'overlay-img', preserveAspectRatio: 'xMidYMid meet' });
      img.style.display = 'none';
      stage.append(img);
    }
    stage.append(flesh, bones, dims, jointsG);
    stages[view] = stage;
    svg.append(stage);
    // 背景操作: ポーズモードでは図の移動/ズーム、参考画像モードでは正面図の参考画像の移動/ズーム
    // (参考画像は通常表示でも動かせる=キャラクターの設定から操作するため。第19弾FB)
    svg.addEventListener('pointerdown', (ev) => startPan(ev, view));
    if (!interactive) svg.addEventListener('touchmove', (ev) => { if (dragTarget === 'overlay') ev.preventDefault(); }, { passive: false });
    return svg;
  }

  function applyViewport() {
    for (const [view, stage] of Object.entries(stages)) {
      const t = viewport.t[view] ?? { x: 0, y: 0 };
      stage.setAttribute('transform', `translate(${fmt(t.x)} ${fmt(t.y)}) scale(${fmt(viewport.s)})`);
    }
  }
  const emitViewport = () => opts.onViewportChange?.(JSON.parse(JSON.stringify(viewport)));

  function applyOverlay() {
    const img = svgs.front?.querySelector('.overlay-img');
    if (!img) return;
    if (!overlayState?.src) { img.style.display = 'none'; return; }
    const w = VIEW_W * overlayState.s; const h = VIEW_H * overlayState.s;
    img.setAttribute('href', overlayState.src);
    img.setAttribute('x', fmt(VIEW_W / 2 - w / 2 + overlayState.t.x));
    img.setAttribute('y', fmt(VIEW_H / 2 - h / 2 + overlayState.t.y));
    img.setAttribute('width', fmt(w));
    img.setAttribute('height', fmt(h));
    img.setAttribute('opacity', overlayState.opacity);
    img.style.display = '';
  }
  const emitOverlay = () => opts.onOverlayChange?.(overlayState ? JSON.parse(JSON.stringify(overlayState)) : null);

  // 背景ドラッグ=パン、2本指=ピンチズーム(関節のドラッグは stopPropagation されるのでここへ来ない)
  const pointers = new Map();
  let pinchStart = null;
  // その面で掴める関節(骨格合わせは正面図だけ。あごは廃止=首の軸は垂直固定)
  function dragIds(view) {
    if (!interactive) return [];
    if (fitMode) return view === 'front' ? ['top', 'hip', ...DRAGGABLE] : [];
    // 側面図は手前側の腕・脚だけ動かせる(右側面=右、左側面=左。点が重なって混乱するため。第42弾FB)
    const far = view === 'side-right' ? 'L' : view === 'side-left' ? 'R' : null;
    const ids = ['hip', ...DRAGGABLE];
    return far ? ids.filter((id) => !(id.endsWith(far) && id !== 'hip')) : ids;
  }
  // 指の位置にいちばん近い関節(点が小さくて掴みづらい・隣の点を掴んでしまう対策。第32弾FB)
  const GRAB_R = 34;
  // prefer: 当たり判定の円そのものの関節。側面図で左右が重なる場合などはそちらを優先する
  function nearestJoint(view, local, prefer = null) {
    let best = null; let bd = GRAB_R;
    for (const id of dragIds(view)) {
      const q = toPx(joints[id], view);
      let d = Math.hypot(q.x - local.x, q.y - local.y);
      // 股関節(骨盤の端)は手首と近く誤操作しやすいので、指がごく近いとき以外は優先度を下げる(第46弾FB)
      if ((id === 'hipL' || id === 'hipR') && d > 10) d *= 1.6;
      if (d < bd) { bd = d; best = id; }
    }
    if (prefer && best && best !== prefer) {
      const q = toPx(joints[prefer], view);
      if (Math.hypot(q.x - local.x, q.y - local.y) <= bd + 1) return prefer;
    }
    return best;
  }
  function startPan(ev, view, force = false) {
    if (!force && ev.target.classList?.contains('pose-hit')) return;
    const svg = svgs[view];
    if (!force && activeDrag) {
      // 関節ドラッグ中の2本目の指: 掴んだ直後ならピンチへ切り替え(startDrag 側で処理)、それ以外は無視
      startDrag(ev, activeDrag.id ?? lastJoint, view);
      return;
    }
    // 点を少し外しても、近くに関節があればその関節を掴む(背景パンに化けない)
    if (!force && interactive && pointers.size === 0) {
      const near = nearestJoint(view, localPoint(svg, view, ev));
      if (near) { startDrag(ev, near, view); return; }
    }
    ev.preventDefault();
    // 「参考画像を動かす」モードでは正面図の背景操作は参考画像に対して行う
    const onOverlay = dragTarget === 'overlay' && view === 'front' && overlayState?.src;
    if (!interactive && !onOverlay) return; // 通常表示では図は動かさない
    if (fitLocked) return; // 位置ロック中は背景操作(パン/ピンチ)で図も画像も動かさない(第26弾FB)
    pointers.set(ev.pointerId, svgPoint(svg, ev));
    let last = svgPoint(svg, ev);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = onOverlay
        ? { d: Math.hypot(a.x - b.x, a.y - b.y), s: overlayState.s, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, t: { ...overlayState.t } }
        : { d: Math.hypot(a.x - b.x, a.y - b.y), s: viewport.s, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, t: { ...(viewport.t[view] ?? { x: 0, y: 0 }) } };
    }
    const move = (e) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const p = svgPoint(svg, e);
      pointers.set(e.pointerId, p);
      if (pointers.size >= 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ns = Math.min(4, Math.max(0.2, (pinchStart.s * d) / (pinchStart.d || 1)));
        // 中点を固定してズーム
        const m = pinchStart.mid;
        const t = pinchStart.t;
        if (onOverlay) {
          // 透かしは中心基準の配置なので、中点固定は中心座標で計算する
          const c0 = { x: VIEW_W / 2 + t.x, y: VIEW_H / 2 + t.y };
          const rel = { x: (m.x - c0.x) / pinchStart.s, y: (m.y - c0.y) / pinchStart.s };
          overlayState.s = ns;
          overlayState.t = { x: m.x - rel.x * ns - VIEW_W / 2, y: m.y - rel.y * ns - VIEW_H / 2 };
          applyOverlay();
          return;
        }
        const local = { x: (m.x - t.x) / pinchStart.s, y: (m.y - t.y) / pinchStart.s };
        viewport.s = ns;
        viewport.t[view] = { x: m.x - local.x * ns, y: m.y - local.y * ns };
        applyViewport();
        return;
      }
      if (e.pointerId !== ev.pointerId) return;
      if (onOverlay) {
        // 透かしは stage(表示倍率)の中に置くので、移動量は表示倍率で割る
        overlayState.t = { x: overlayState.t.x + (p.x - last.x) / viewport.s, y: overlayState.t.y + (p.y - last.y) / viewport.s };
        last = p;
        applyOverlay();
        return;
      }
      const t = viewport.t[view] ?? { x: 0, y: 0 };
      viewport.t[view] = { x: t.x + (p.x - last.x), y: t.y + (p.y - last.y) };
      last = p;
      applyViewport();
    };
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (onOverlay) emitOverlay(); else emitViewport();
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // すべての関節(+頭)が各面に収まるように倍率と位置を決める(倍率は3面共通)
  function fitAll() {
    const margin = 28;
    let s = Infinity;
    const boxes = {};
    for (const view of Object.keys(svgs)) {
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      const pts = Object.keys(joints).map((id) => toPx(joints[id], view));
      const hg = headGeom(view);
      pts.push({ x: hg.c.x - hg.r, y: hg.c.y - hg.r }, { x: hg.c.x + hg.r, y: hg.c.y + hg.r });
      for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const pad = W.leg; // 肉付けの太さぶん
      boxes[view] = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
      const bw = boxes[view].maxX - boxes[view].minX; const bh = boxes[view].maxY - boxes[view].minY;
      s = Math.min(s, (VIEW_W - margin * 2) / bw, (VIEW_H - margin * 2) / bh);
    }
    s = Math.min(1.6, Math.max(0.3, s));
    viewport.s = s;
    for (const [view, b] of Object.entries(boxes)) {
      const cx = (b.minX + b.maxX) / 2; const cy = (b.minY + b.maxY) / 2;
      viewport.t[view] = { x: VIEW_W / 2 - cx * s, y: VIEW_H / 2 - cy * s };
    }
    applyViewport();
    emitViewport();
  }
  // ドラッグ可能な関節がすべて各面の枠内にあるか
  function allJointsVisible() {
    const margin = 6;
    for (const view of Object.keys(svgs)) {
      const t = viewport.t[view] ?? { x: 0, y: 0 };
      for (const id of DRAGGABLE) {
        const p = toPx(joints[id], view);
        const x = p.x * viewport.s + t.x; const y = p.y * viewport.s + t.y;
        if (x < margin || y < margin || x > VIEW_W - margin || y > VIEW_H - margin) return false;
      }
    }
    return true;
  }
  function zoomBy(f) {
    const ns = Math.min(3, Math.max(0.3, viewport.s * f));
    for (const view of Object.keys(svgs)) {
      // 画面中央を固定
      const t = viewport.t[view] ?? { x: 0, y: 0 };
      const local = { x: (VIEW_W / 2 - t.x) / viewport.s, y: (VIEW_H / 2 - t.y) / viewport.s };
      viewport.t[view] = { x: VIEW_W / 2 - local.x * ns, y: VIEW_H / 2 - local.y * ns };
    }
    viewport.s = ns;
    applyViewport();
    emitViewport();
  }
  function resetView() {
    viewport.s = 1;
    for (const view of Object.keys(svgs)) viewport.t[view] = { x: 0, y: 0 };
    applyViewport();
    emitViewport();
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
        if (a.startsWith('ankle')) {
          // 足の参考線は「かかと→つま先」(足裏)。足首→かかとは接続しろで描く
          setLine(line, toPx(heel3(a.slice(5)), view), toPx(joints[b], view));
          continue;
        }
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
        // 足首の先の接続しろは足首→かかと(すねの延長。足の中に収まる=足を動かしても露出しない)
        const an = toPx(joints[`ankle${s}`], view); const he = toPx(heel3(s), view);
        setLine(svg.querySelector(`.stub[data-stub=ankle${s}]`), an, add(an, mul(sub(he, an), 0.9)));
        setEllipse(svg.querySelector(`.hand-ref[data-side=${s}]`), handEllipse(view, s));
        const f = footShape(view, s);
        const fe = svg.querySelector(`.foot-ref-e[data-side=${s}]`);
        const fl = svg.querySelector(`.foot-ref-l[data-side=${s}]`);
        if (f.kind === 'ellipse') { setEllipse(fe, f); fe.style.display = ''; fl.style.display = 'none'; }
        else { setLine(fl, f.a, f.b); fl.style.display = ''; fe.style.display = 'none'; }
      }
      // 肉付け
      const parts = torsoParts(view);
      svg.querySelector('.flesh .part-chest').setAttribute('d', parts.chest);
      svg.querySelector('.flesh .part-abdomen').setAttribute('d', parts.abdomen);
      svg.querySelector('.flesh .part-pelvis').setAttribute('d', parts.pelvis);
      for (const path of svg.querySelectorAll('.flesh path[data-seg]')) {
        const [a, b] = path.dataset.seg.split('-');
        const pa = toPx(joints[a], view); const pb = toPx(joints[b], view);
        // 上腕は肩関節から描き始める(関節点=肩の丸みの中心。胴の輪郭側が関節点まわりの丸みを持つ)
        const prof = path.classList.contains('upper') ? LIMB_PROFILE.upper
          : path.classList.contains('lower') ? LIMB_PROFILE.lower
            : path.classList.contains('thigh') ? LIMB_PROFILE.thigh : LIMB_PROFILE.shin;
        path.setAttribute('d', limbPath(pa, pb, prof));
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
      neck.setAttribute('stroke-width', W.neck * 1.0);
      // 頭は参考輪郭(頭高)より一回り大きく(髪のボリューム分。第18弾FB)
      setEllipse(svg.querySelector('.head-flesh'), { c: add(hg.c, mul(hg.dir, hg.r * 0.06)), rx: hg.r * 1.06, ry: hg.r * 1.1, ang: 0 });
      // 関節
      for (const c of svg.querySelectorAll('circle[data-joint]')) {
        const p = toPx(joints[c.dataset.joint], view);
        c.setAttribute('cx', fmt(p.x)); c.setAttribute('cy', fmt(p.y));
      }
      // 寸法注記(直立のときだけ)
      const dims = svg.querySelector('.dims');
      dims.replaceChildren();
      if (!posed && !fitMode) appendDims(dims, view);
    }
  }

  function appendDims(dims, view) {
    const kneeY = g.hipY + seg.thigh * k;
    const ankleY = kneeY + seg.shin * k;
    if (view === 'front') {
      // 注記が枠内に収まるよう、右端からの余白を確保(「腰〜足先 10.6cm」のような桁増えでも切れない)
      const rightX = Math.min(g.cx + Math.max(g.shoulderHalf, g.hipHalf) + 52, VIEW_W - 106);
      dims.append(
        dimLineH(g.top - 14, g.cx - g.shoulderHalf, g.cx + g.shoulderHalf, `肩幅 ${seg.shoulderWidth}cm`),
        dimLineV(rightX, g.top, g.hipY, `頭〜腰 ${seg.headTopToHip}cm`),
        dimLineV(rightX, g.hipY, g.soleY, `腰〜足先 ${seg.hipToSole}cm`),
        dimLineV(g.cx - g.shoulderHalf - 36, g.shoulderY, g.shoulderY + seg.armTotal * k, `腕 ${seg.armTotal}cm`, 'end'),
      );
    } else if (view === 'side-left') {
      const hx = hipX(view);
      dims.append(dimLineV(hx - g.headR - 50, g.top, g.soleY, `全高 ${seg.figureHeight}cm`, 'end'));
    } else {
      dims.append(
        dimLineH(g.soleY + 24, g.cx - seg.footLength * k * 0.3, g.cx + seg.footLength * k * 0.7, `足 ${seg.footLength}cm`),
        dimLineV(g.cx + 50, g.hipY, kneeY, `もも ${seg.thigh}cm`),
        dimLineV(g.cx + 50, kneeY, ankleY, `すね ${seg.shin}cm`),
      );
    }
  }

  function svgPoint(svg, ev) {
    const m = svg.getScreenCTM?.();
    if (m && typeof DOMPoint === 'function') {
      const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      return { x: q.x, y: q.y };
    }
    const r = svg.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * VIEW_W, y: ((ev.clientY - r.top) / r.height) * VIEW_H };
  }
  // 表示位置・倍率を差し引いた図の座標(関節ドラッグ用)
  function localPoint(svg, view, ev) {
    const p = svgPoint(svg, ev);
    const t = viewport.t[view] ?? { x: 0, y: 0 };
    return { x: (p.x - t.x) / viewport.s, y: (p.y - t.y) / viewport.s };
  }

  // 左右対称: 骨格合わせでは反対側を体の中心線(股のx)で鏡映した位置に置く
  function mirrorFit(id) {
    const pair = MIRROR_PAIR[id];
    if (!mirrorMove || !pair) return;
    const cx = joints.hip.x;
    const moved = { ...joints };
    // 動かした関節とその先(回した場合は先も動く)を鏡映
    for (const src of [id, ...(FIT_DESC[id] ?? [])]) {
      const dst = MIRROR_PAIR[src];
      if (dst) moved[dst] = { x: 2 * cx - joints[src].x, y: joints[src].y, z: joints[dst].z };
    }
    joints = moved;
  }
  // 骨格合わせで腕・脚を「回す」: 親を中心に、長さを保って指の方向へ。先の関節も一緒に回る(2D)
  function fitRotate(id, uv) {
    const p = joints[PARENT_OF[id]];
    const cur = { x: joints[id].x - p.x, y: joints[id].y - p.y };
    const L = Math.hypot(cur.x, cur.y);
    const dx = uv.u - p.x; const dy = uv.v - p.y;
    const dl = Math.hypot(dx, dy);
    if (L < 1e-6 || dl < 1e-6) return;
    const a0 = Math.atan2(cur.y, cur.x); const a1 = Math.atan2(dy, dx);
    const da = a1 - a0; const c = Math.cos(da); const sn = Math.sin(da);
    const moved = { ...joints };
    for (const k2 of [id, ...(FIT_DESC[id] ?? [])]) {
      const v = { x: joints[k2].x - p.x, y: joints[k2].y - p.y };
      moved[k2] = { x: p.x + v.x * c - v.y * sn, y: p.y + v.x * sn + v.y * c, z: joints[k2].z };
    }
    joints = moved;
  }
  const PARENT_OF = {
    elbowL: 'shoulderL', elbowR: 'shoulderR', wristL: 'elbowL', wristR: 'elbowR',
    kneeL: 'hipL', kneeR: 'hipR', ankleL: 'kneeL', ankleR: 'kneeR', toeL: 'ankleL', toeR: 'ankleR',
  };
  // 左右対称: ポーズでは、動かした関節の結果位置を中心線で鏡映した点を目標に反対側もFKで動かす(側面図では同じ位置)
  function mirrorPose(id, view) {
    const pair = MIRROR_PAIR[id];
    if (!mirrorMove || !pair) return;
    const p = project(joints[id], view);
    const target = view === 'front' ? { u: 2 * project(joints.hip, view).u - p.u, v: p.v } : { u: p.u, v: p.v };
    joints = dragJoint(joints, lengths, pair, target, view);
  }

  let lastJoint = null;
  // 進行中の関節ドラッグ(1本のみ)。2本目の指は無視するか、掴んだ直後ならドラッグを取り消してピンチに切り替える
  // (第44弾FB「腕が変に伸びる」: 2本指で拡大しようとした1本目が関節を掴み、関節が引っ張られていた)
  let activeDrag = null;
  function startDrag(ev, id, view) {
    ev.preventDefault();
    ev.stopPropagation();
    if (activeDrag) {
      if (activeDrag.view === view && !activeDrag.moved && performance.now() - activeDrag.t0 < 400) {
        // 掴んだ直後に2本目 → ピンチ操作とみなす: ドラッグを取り消して、2本の指で背景操作(パン/ピンチ)へ
        const first = activeDrag.ev;
        activeDrag.cancel();
        pointers.set(first.pointerId, svgPoint(svgs[view], first));
        startPan(ev, view, true);
      }
      return; // ドラッグ中の追加の指は無視
    }
    const svg = svgs[view];
    const pointerId = ev.pointerId;
    try { ev.currentTarget.setPointerCapture(pointerId); } catch { /* window監視で継続 */ }
    lastJoint = id;
    const jointsAtStart = joints;
    for (const sv of Object.values(svgs)) sv.querySelector(`.pose-dot[data-joint=${id}]`)?.classList.add('is-active');
    const label = (fitMode ? FIT_LABELS[id] : POSE_LABELS[id]) ?? JOINT_LABELS[id];
    opts.onJointPick?.(id, label);
    // 注意: ドラッグ中に案内文を書き換えると行数変化で図が上下に動き、指の下の座標がずれて関節が飛ぶ
    // (第24弾FB「肩の位置がおかしい」の原因)。案内文の更新は pointerup 後に行う
    const statusText = fitMode
      ? (FIT_ROTATE.has(id) && !fitFree
        ? `${label}を回しました(長さはそのまま。長さを変えるには「長さも動かす」)`
        : `${label}を動かしました(長さが変わります)`)
      : id === 'hip'
        ? '骨格全体を移動しました'
        : `${label}を動かしました(長さは不変)`;
    // 掴んだ位置と関節の差(オフセット)を保ち、指の「移動量」だけ関節を動かす。
    // 最寄り関節グラブで指が関節から離れていても、関節が指の位置へ跳ばない(第34弾FB「ロックしたのに斜めに動く」の主因)
    const finger0 = localPoint(svg, view, ev);
    const start = toPx(joints[id], view); // ドラッグ開始時の関節位置(px)
    const grabOff = { x: start.x - finger0.x, y: start.y - finger0.y };
    const j0 = project(joints[id], view); // 同(図の座標。縦横ロックの直線の基準)
    let lockedAxis = null;
    // 方向ロック: 最初の数pxの動きで縦/横を決め、以後その軸だけ動かす
    const applyLock = (lp) => {
      if (!axisLock) return lp;
      if (!lockedAxis) {
        const dx = lp.x - start.x; const dy = lp.y - start.y;
        if (Math.hypot(dx, dy) < 6) return start;
        lockedAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
      return lockedAxis === 'x' ? { x: lp.x, y: start.y } : { x: start.x, y: lp.y };
    };
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      const fp = localPoint(svg, view, e);
      if (activeDrag && Math.hypot(fp.x - finger0.x, fp.y - finger0.y) > 4) activeDrag.moved = true;
      const local = applyLock({ x: fp.x + grabOff.x, y: fp.y + grabOff.y });
      if (fitMode) {
        // 体型合わせ: 正面図で関節を自由に動かす(骨の長さは変わる。子は動かさない)
        const uv = fromPx(local, view);
        if (id === 'hip') {
          const dx = uv.u - joints.hip.x; const dy = uv.v - joints.hip.y;
          // 股=骨格全体の平行移動(参考画像に骨格を寄せる。第22弾FB)。
          // 位置ロック中は骨盤(股+左右の股関節)だけを動かす(微調整で全体が動かないように。第25弾FB)
          const ids = fitLocked ? ['hip', 'hipL', 'hipR'] : Object.keys(joints);
          const moved = { ...joints };
          for (const k2 of ids) moved[k2] = { x: joints[k2].x + dx, y: joints[k2].y + dy, z: joints[k2].z };
          joints = moved;
          redraw();
          return;
        }
        if (id === 'top' || id === 'spineTop') {
          // 首の軸は常に垂直: 頭頂は首のつけ根の真上で上下だけ(頭の大きさ)、首のつけ根を動かすと頭・首もついてくる。
          // あごの位置は頭頂〜首のつけ根の間の割合を保つ(首の長さの比率は変えない)
          const frac = (joints.neck.y - joints.top.y) / Math.max(1e-6, joints.spineTop.y - joints.top.y);
          const moved = { ...joints };
          if (id === 'top') {
            moved.top = { x: joints.spineTop.x, y: Math.min(uv.v, joints.spineTop.y - 0.5), z: joints.top.z };
          } else {
            const dx = uv.u - joints.spineTop.x; const dy = uv.v - joints.spineTop.y;
            moved.spineTop = { x: uv.u, y: uv.v, z: joints.spineTop.z };
            moved.top = { x: joints.top.x + dx, y: Math.min(joints.top.y, uv.v - 0.5), z: joints.top.z };
            // 肩は首のつけ根の線上(芯材はT字)。首のつけ根を動かすと肩も一緒に動く(ヒジ・手首は画像に置いたまま)
            for (const sh of ['shoulderL', 'shoulderR']) moved[sh] = { x: joints[sh].x + dx, y: joints[sh].y + dy, z: joints[sh].z };
          }
          moved.neck = { x: moved.spineTop.x, y: moved.top.y + frac * (moved.spineTop.y - moved.top.y), z: joints.neck.z };
          joints = moved;
          redraw();
          return;
        }
        if (id === 'shoulderL' || id === 'shoulderR') {
          // 肩は左右(幅)だけ動かし、高さは首のつけ根の線に揃える(取り込み後に肩線がずれない。第32弾FB)
          joints = { ...joints, [id]: { x: uv.u, y: joints.spineTop.y, z: joints[id].z } };
          mirrorFit(id);
          redraw();
          return;
        }
        if (!fitFree && FIT_ROTATE.has(id)) {
          // 既定: 長さを保って持ち上げる(回す)。長さを変えるのは「長さも動かす」ON のときだけ
          fitRotate(id, uv);
          mirrorFit(id);
          redraw();
          return;
        }
        joints = { ...joints, [id]: { x: uv.u, y: uv.v, z: joints[id].z } };
        mirrorFit(id);
        if (id === 'hipL' || id === 'hipR') {
          const other = id === 'hipL' ? 'hipR' : 'hipL';
          if (mirrorMove) {
            // 左右対称: 股を動かさず、反対側の股関節を股のxで鏡映(骨盤幅の調整。第36弾FB)
            joints[other] = { x: 2 * joints.hip.x - joints[id].x, y: joints[id].y, z: joints[other].z };
            joints.hip = { x: joints.hip.x, y: joints[id].y, z: joints.hip.z };
          } else {
            // 骨盤は股を中点に保つ
            joints.hip = { x: (joints[id].x + joints[other].x) / 2, y: (joints[id].y + joints[other].y) / 2, z: joints.hip.z };
          }
        }
        redraw();
        return;
      }
      if (id === 'hip') {
        // ポーズ中の股=骨格全体の平行移動(その面の2軸だけ動かす)
        const uv = fromPx(local, view);
        const nh = unproject(uv, view, joints.hip);
        const d = { x: nh.x - joints.hip.x, y: nh.y - joints.hip.y, z: nh.z - joints.hip.z };
        const moved = {};
        for (const k2 of Object.keys(joints)) moved[k2] = { x: joints[k2].x + d.x, y: joints[k2].y + d.y, z: joints[k2].z + d.z };
        joints = moved;
        redraw();
        return;
      }
      // 縦横ロック中のFK関節: 骨長固定のため関節は親を中心とする弧上しか動けず「直線移動」は幾何的に成り立たない
      // (直線と円の交点は2点のみ)。指の動きを軸に固定するだけにとどめる(直線移動は骨格合わせ・股=全体移動で有効)
      const uv = fromPx(local, view);
      joints = dragJoint(joints, lengths, id, uv, view);
      mirrorPose(id, view);
      redraw();
    };
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      for (const sv of Object.values(svgs)) sv.querySelector(`.pose-dot[data-joint=${id}]`)?.classList.remove('is-active');
      activeDrag = null;
    };
    const up = (e) => {
      if (e.pointerId !== pointerId) return;
      detach();
      opts.onStatus?.(statusText);
      opts.onPoseChange?.(joints, isPosed(joints, rest)); // ポーズモードでは案内文(寸法不変)がこちらで上書きされる
      // 関節が枠外に出て掴めなくなったら自動で全体を収める(PD追加コメント: 動かすと届かない部分が増える)。
      // 骨格合わせ中は行わない(参考画像との位置関係を勝手に動かさない。第26弾FB)
      if (!fitMode && !allJointsVisible()) fitAll();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    activeDrag = {
      pointerId, view, ev, t0: performance.now(), moved: false,
      cancel: () => { detach(); joints = jointsAtStart; redraw(); },
    };
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
    applyViewport();
    applyOverlay();
    svgs.front?.classList.toggle('overlay-drag', dragTarget === 'overlay');
  }

  mount();
  return {
    reset() {
      joints = rest;
      redraw();
      resetView(); // ポーズと一緒に表示位置・倍率も初期に戻す
      opts.onPoseChange?.(joints, false);
    },
    resetJoint(id = lastJoint) {
      if (!id) return;
      joints = resetJoint(joints, lengths, rest, id);
      redraw();
      opts.onPoseChange?.(joints, isPosed(joints, rest));
    },
    lastJoint: () => lastJoint,
    setFitLocked(v) { fitLocked = !!v; },
    setFitFree(v) { fitFree = !!v; },
    // 通常表示(直立)の標準位置: 頭頂y=上端pad、足裏y=下端、股x=既定(取り込み後の参考画像の追従用)
    standardFrame: () => ({ topY: g.top, soleY: g.soleY, hipX: g.cx }),
    // 正面投影の関節位置(px、表示倍率を除く)。体型合わせの取り込み(skeleton2d)用
    getFrontJointsPx() {
      const out = {};
      for (const id of Object.keys(joints)) out[id] = toPx(joints[id], 'front');
      // かかと=くるぶしの足首高ぶん下(足裏の位置)。skeleton2d の全高基準に使う
      out.heelL = { x: out.ankleL.x, y: out.ankleL.y + seg.ankle * k };
      out.heelR = { x: out.ankleR.x, y: out.ankleR.y + seg.ankle * k };
      out.chin = out.neck;
      return out;
    },
    // ひねり(差分角度)。upper=上半身(肩)、lower=骨盤+脚(腰)を背骨軸まわりに回す
    twist(deltaDeg) { this.twistUpper(deltaDeg); },
    twistUpper(deltaDeg) {
      joints = twistUpper(joints, lengths, deltaDeg);
      redraw();
      opts.onPoseChange?.(joints, isPosed(joints, rest));
    },
    twistLower(deltaDeg) {
      joints = twistLower(joints, lengths, deltaDeg);
      redraw();
      opts.onPoseChange?.(joints, isPosed(joints, rest));
    },
    fitAll, zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8), resetView,
    // 透かし画像
    setOverlay(src) {
      // 初期位置: 骨格の中心線(hipX)に画像の中心を合わせる
      overlayState = { src, t: { x: hipX('front') - VIEW_W / 2, y: 0 }, s: 1, opacity: 0.45 };
      applyOverlay();
      emitOverlay();
    },
    clearOverlay() { overlayState = null; applyOverlay(); emitOverlay(); },
    hasOverlay: () => !!overlayState?.src,
    overlayZoom(f) {
      if (!overlayState) return;
      overlayState.s = Math.min(4, Math.max(0.2, overlayState.s * f));
      applyOverlay();
      emitOverlay();
    },
    setAxisLock(v) { axisLock = !!v; },
    setMirror(v) { mirrorMove = !!v; },
    setDragTarget(t) {
      dragTarget = t === 'overlay' ? 'overlay' : 'view';
      svgs.front?.classList.toggle('overlay-drag', dragTarget === 'overlay');
    },
    getJoints: () => joints,
    isPosed: () => isPosed(joints, rest),
    setFlesh(on) {
      for (const svg of Object.values(svgs)) svg.classList.toggle('with-flesh', !!on);
    },
  };
}
