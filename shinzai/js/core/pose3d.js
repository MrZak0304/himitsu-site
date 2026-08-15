// js/core/pose3d.js — 三面図の連動ポーズ(UI非依存・ピュア関数)
//
// 関節を3D座標 {x: 左右(右が+), y: 上下(下が+), z: 前後(前が+)} で持つ。
// 正面図=xy平面、右側面=zy平面(前が右)、左側面=zy平面のミラー(前が左)への投影。
// ドラッグは投影面の2軸だけを動かし、残り1軸は保持する。
// 骨の長さは維持(FK): 親関節を支点に骨を回転させ、子孫の関節は追従する。
// → 切り出し寸法は変わらず、「切った芯をどこでどう曲げるか」の指示図になる。

// 親子関係(体幹→骨盤→脚、体幹→肩→腕)。root は hip(股)。
export const PARENT = {
  hip: null,
  spineTop: 'hip', // 首のつけ根(肩バーの中心)
  neck: 'spineTop', // あご下
  top: 'neck', // 頭頂(参考)
  shoulderL: 'spineTop', shoulderR: 'spineTop',
  elbowL: 'shoulderL', elbowR: 'shoulderR',
  wristL: 'elbowL', wristR: 'elbowR',
  hipL: 'hip', hipR: 'hip',
  kneeL: 'hipL', kneeR: 'hipR',
  ankleL: 'kneeL', ankleR: 'kneeR',
  // つま先: 芯の関節ではないが、完成イメージのため足の向きを動かせる(2026-08-15 PDフィードバック第13弾)
  toeL: 'ankleL', toeR: 'ankleR',
};

// 描画用の骨(線)の一覧
export const BONES = [
  ['hip', 'spineTop'], ['spineTop', 'neck'],
  ['shoulderL', 'shoulderR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hipL', 'hipR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
  ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
];

// 足(足首→つま先)。芯ではないので BONES とは別(参考輪郭として描く)
export const FOOT_BONES = [['ankleL', 'toeL'], ['ankleR', 'toeR']];

// ドラッグできる関節(top/neck は参考なので固定)
export const DRAGGABLE = [
  'spineTop', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR',
];

export const JOINT_LABELS = {
  spineTop: '首のつけ根', shoulderL: '肩(左)', shoulderR: '肩(右)',
  elbowL: 'ヒジ(左)', elbowR: 'ヒジ(右)', wristL: '手首(左)', wristR: '手首(右)',
  hipL: '股関節(左)', hipR: '股関節(右)',
  kneeL: 'ヒザ(左)', kneeR: 'ヒザ(右)', ankleL: '足首(左)', ankleR: '足首(右)',
  toeL: 'つま先(左)', toeR: 'つま先(右)',
};

// 直立(Tではなく気をつけ気味)の初期ポーズ。単位=cm、原点=股、yは下が+。
// segments は computeArmature().segments
export function restPose(seg) {
  const spineLen = seg.headTopToHip - seg.head; // あご下〜股
  // 肩の高さ: あご下から頭高の0.35下(首の長さ。0.15では首がなく頭が肩に乗って見えた=第18〜19弾FB)
  const NECK_LEN = seg.head * 0.35;
  const shoulderY = -(spineLen - NECK_LEN);
  const shHalf = seg.shoulderWidth / 2;
  const hipHalf = shHalf * 0.75;
  const armDx = 0.06 * seg.figureHeight; // 腕は体からやや外へ
  const j = {
    hip: { x: 0, y: 0, z: 0 },
    spineTop: { x: 0, y: shoulderY, z: 0 },
    neck: { x: 0, y: -spineLen, z: 0 },
    top: { x: 0, y: -seg.headTopToHip, z: 0 },
    shoulderL: { x: -shHalf, y: shoulderY, z: 0 },
    shoulderR: { x: shHalf, y: shoulderY, z: 0 },
    hipL: { x: -hipHalf, y: 0, z: 0 },
    hipR: { x: hipHalf, y: 0, z: 0 },
  };
  for (const [side, s] of [['L', -1], ['R', 1]]) {
    const elbow = { x: s * (shHalf + armDx * 0.5), y: shoulderY + seg.upperArm, z: 0 };
    j[`elbow${side}`] = elbow;
    j[`wrist${side}`] = { x: elbow.x + s * armDx * 0.3, y: elbow.y + seg.forearm, z: 0 };
    const knee = { x: s * hipHalf * 0.85, y: seg.thigh, z: 0 };
    j[`knee${side}`] = knee;
    const ankle = { x: s * hipHalf * 0.8, y: seg.thigh + seg.shin, z: 0 };
    j[`ankle${side}`] = ankle;
    // つま先: 足首から足裏まで下り、前(+z)へ足長の7割
    j[`toe${side}`] = { x: ankle.x, y: ankle.y + seg.ankle, z: seg.footLength * 0.7 };
  }
  // 骨長は初期ポーズから確定(以後、ドラッグしても不変)
  return normalizeLengths(j, boneLengths(j));
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function len(v) { return Math.hypot(v.x, v.y, v.z); }

export function boneLengths(joints) {
  const out = {};
  for (const [id, parent] of Object.entries(PARENT)) {
    if (parent) out[id] = len(sub(joints[id], joints[parent]));
  }
  return out;
}

// 各骨を親からの方向を保ったまま指定の長さに揃える(数値誤差の蓄積防止)
function normalizeLengths(joints, lengths) {
  const out = { ...joints };
  const order = topoOrder();
  for (const id of order) {
    const parent = PARENT[id];
    if (!parent) continue;
    const dir = sub(out[id], out[parent]);
    const l = len(dir);
    const target = lengths[id];
    if (l < 1e-9) {
      out[id] = add(out[parent], { x: 0, y: target, z: 0 });
    } else {
      const k = target / l;
      out[id] = add(out[parent], { x: dir.x * k, y: dir.y * k, z: dir.z * k });
    }
  }
  return out;
}

function topoOrder() {
  const order = [];
  const visit = (id) => {
    if (order.includes(id)) return;
    if (PARENT[id]) visit(PARENT[id]);
    order.push(id);
  };
  for (const id of Object.keys(PARENT)) visit(id);
  return order;
}

function descendants(id) {
  const out = [];
  for (const [child, parent] of Object.entries(PARENT)) {
    if (parent === id) {
      out.push(child, ...descendants(child));
    }
  }
  return out;
}

// 投影: view = 'front' | 'side-right' | 'side-left' → {u, v}(u=横, v=縦、cm)
export function project(p, view) {
  if (view === 'front') return { u: p.x, v: p.y };
  if (view === 'side-right') return { u: p.z, v: p.y }; // 前が右
  return { u: -p.z, v: p.y }; // side-left: 前が左
}

// 投影面上のドラッグ位置 {u, v} を3D座標に戻す(面に垂直な軸は元の値を保持)
export function unproject(uv, view, orig) {
  if (view === 'front') return { x: uv.u, y: uv.v, z: orig.z };
  if (view === 'side-right') return { x: orig.x, y: uv.v, z: uv.u };
  return { x: orig.x, y: uv.v, z: -uv.u };
}

// 関節 id を、投影面 view 上の位置 uv に向けて動かす(FK)。
//   ・骨長は維持: 親→id の方向だけが変わり、長さは lengths[id] のまま
//   ・id の子孫は同じ回転で追従(平行移動ではなく、親関節まわりの回転)
//   ・肩バー/骨盤バー(spineTop/hip の子)は他方の端も対称に扱わず独立(片肩上げ等ができる)
export function dragJoint(joints, lengths, id, uv, view) {
  const parent = PARENT[id];
  if (!parent) return joints; // root は動かさない
  const from = sub(joints[id], joints[parent]);
  const L = lengths[id];
  // 面に垂直な成分(正面なら z、側面なら x)は保持し、面内の長さだけで骨長を満たす
  const perpAxis = view === 'front' ? 'z' : 'x';
  const perp = from[perpAxis];
  const inPlaneLen = Math.sqrt(Math.max(0, L * L - perp * perp));
  const pParent = project(joints[parent], view);
  const du = uv.u - pParent.u;
  const dv = uv.v - pParent.v;
  const dl = Math.hypot(du, dv);
  if (dl < 1e-6 || inPlaneLen < 1e-6) return joints; // 親と重なる/骨が面に垂直
  const k = inPlaneLen / dl;
  const rel3 = unproject({ u: du * k, v: dv * k }, view, { x: 0, y: 0, z: 0 });
  rel3[perpAxis] = perp;
  const out = { ...joints };
  const newPos = add(joints[parent], rel3);
  // 骨盤バー・肩バーは剛体: 片端を動かすと反対側は親(股/首のつけ根)を中心に鏡映で追従し、
  // バーは常に背骨を通る(2026-08-15 PDフィードバック第11弾「腰と胴体の連動」)。
  const mirror = MIRROR[id];
  // 子孫を回転で追従: from→to の回転を子孫の(親からの相対)ベクトルに適用
  const rot = rotationBetween(from, sub(newPos, joints[parent]));
  const oldSelf = joints[id];
  out[id] = newPos;
  for (const d of descendants(id)) {
    const rel = sub(joints[d], oldSelf);
    out[d] = add(newPos, rot(rel));
  }
  if (mirror) {
    // 反対側の端: 親を中心に鏡映(同じ回転を反対側にも適用するのと同値)
    const pParent3 = joints[parent];
    const oldM = joints[mirror];
    const newM = sub(add(pParent3, pParent3), newPos); // 2*parent - newPos
    out[mirror] = newM;
    for (const d of descendants(mirror)) {
      const rel = sub(joints[d], oldM);
      out[d] = add(newM, rot(rel));
    }
  }
  return normalizeLengths(out, lengths);
}

const MIRROR = { hipL: 'hipR', hipR: 'hipL', shoulderL: 'shoulderR', shoulderR: 'shoulderL' };

// 関節1つを初期位置に戻す(2026-08-15 PDフィードバック第12弾)。
// 「親から見た方向」を直立(rest)のときの方向に戻し、子孫は同じ回転で追従する。
// 親が動いていてもその関節から先だけが直立時の向きに戻る。剛体バーの端は反対側も戻る。
export function resetJoint(joints, lengths, rest, id) {
  const parent = PARENT[id];
  if (!parent) return joints;
  const restRel = sub(rest[id], rest[parent]);
  const rl = len(restRel);
  if (rl < 1e-9) return joints;
  const k = lengths[id] / rl;
  const target = add(joints[parent], { x: restRel.x * k, y: restRel.y * k, z: restRel.z * k });
  const rot = rotationBetween(sub(joints[id], joints[parent]), sub(target, joints[parent]));
  const out = { ...joints };
  const oldSelf = joints[id];
  out[id] = target;
  for (const d of descendants(id)) out[d] = add(target, rot(sub(joints[d], oldSelf)));
  const mirror = MIRROR[id];
  if (mirror) {
    const oldM = joints[mirror];
    const newM = sub(add(joints[parent], joints[parent]), target);
    out[mirror] = newM;
    for (const d of descendants(mirror)) out[d] = add(newM, rot(sub(joints[d], oldM)));
  }
  return normalizeLengths(out, lengths);
}

// 首の接続しろ(頭への差し込み)の先端。neck から top 方向へ頭高の1/3
export function neckStubEnd(joints, headCm) {
  const dir = sub(joints.top, joints.neck);
  const l = len(dir) || 1;
  const s = headCm / 3;
  return add(joints.neck, { x: (dir.x / l) * s, y: (dir.y / l) * s, z: (dir.z / l) * s });
}

// ベクトル a を b の向きに合わせる回転(ロドリゲス)。a,b は非ゼロ
function rotationBetween(a, b) {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return (v) => v;
  const ax = a.x / la; const ay = a.y / la; const az = a.z / la;
  const bx = b.x / lb; const by = b.y / lb; const bz = b.z / lb;
  // 回転軸 = a×b、角度 = acos(a・b)
  const kx = ay * bz - az * by;
  const ky = az * bx - ax * bz;
  const kz = ax * by - ay * bx;
  const s = Math.hypot(kx, ky, kz);
  const c = ax * bx + ay * by + az * bz;
  if (s < 1e-9) {
    if (c > 0) return (v) => v; // 同方向
    // 正反対: 適当な直交軸で180度
    const axis = Math.abs(ax) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const px = ay * axis.z - az * axis.y;
    const py = az * axis.x - ax * axis.z;
    const pz = ax * axis.y - ay * axis.x;
    const pl = Math.hypot(px, py, pz);
    const ux = px / pl; const uy = py / pl; const uz = pz / pl;
    return (v) => {
      const d = v.x * ux + v.y * uy + v.z * uz;
      return { x: 2 * d * ux - v.x, y: 2 * d * uy - v.y, z: 2 * d * uz - v.z };
    };
  }
  const ux = kx / s; const uy = ky / s; const uz = kz / s;
  return (v) => {
    // v*c + (u×v)*s + u*(u・v)*(1-c)
    const cx = uy * v.z - uz * v.y;
    const cy = uz * v.x - ux * v.z;
    const cz = ux * v.y - uy * v.x;
    const d = ux * v.x + uy * v.y + uz * v.z;
    return {
      x: v.x * c + cx * s + ux * d * (1 - c),
      y: v.y * c + cy * s + uy * d * (1 - c),
      z: v.z * c + cz * s + uz * d * (1 - c),
    };
  };
}

// 全関節が直立(restPose)からどれだけ動いたか(ポーズ中かどうかの判定用)
export function isPosed(joints, rest, eps = 0.05) {
  return Object.keys(PARENT).some((id) => len(sub(joints[id], rest[id])) > eps);
}

// ひねり(2026-08-15 PDフィードバック第15〜16弾)。背骨の軸(股→首のつけ根)まわりの回転。
//   twistUpper: 上半身(首のつけ根から先=肩・腕・首・頭)を回す(肩のひねり)
//   twistLower: 骨盤+脚(股関節から先)を回す(腰のひねり)。体幹・肩はそのまま
function rotateAroundSpine(joints, lengths, deltaDeg, ids, pivot) {
  if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) < 1e-9) return joints;
  const axis = sub(joints.spineTop, joints.hip);
  const al = len(axis);
  if (al < 1e-9) return joints;
  const ux = axis.x / al; const uy = axis.y / al; const uz = axis.z / al;
  const th = (deltaDeg * Math.PI) / 180;
  const c = Math.cos(th); const s = Math.sin(th);
  const rot = (v) => {
    const cx = uy * v.z - uz * v.y;
    const cy = uz * v.x - ux * v.z;
    const cz = ux * v.y - uy * v.x;
    const d = ux * v.x + uy * v.y + uz * v.z;
    return {
      x: v.x * c + cx * s + ux * d * (1 - c),
      y: v.y * c + cy * s + uy * d * (1 - c),
      z: v.z * c + cz * s + uz * d * (1 - c),
    };
  };
  const out = { ...joints };
  for (const id of ids) out[id] = add(pivot, rot(sub(joints[id], pivot)));
  return normalizeLengths(out, lengths);
}

export function twistUpper(joints, lengths, deltaDeg) {
  return rotateAroundSpine(joints, lengths, deltaDeg, descendants('spineTop'), joints.spineTop);
}

export function twistLower(joints, lengths, deltaDeg) {
  const ids = ['hipL', 'hipR', ...descendants('hipL'), ...descendants('hipR')];
  return rotateAroundSpine(joints, lengths, deltaDeg, ids, joints.hip);
}
