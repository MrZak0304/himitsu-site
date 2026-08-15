// js/core/skeleton2d.js — 画像上の関節座標(px)から体型比率を推定するピュアロジック
// UI(js/ui/photofit.js)がドラッグで確定した関節位置を受け取り、
// proportions.js 互換の比率セットに変換する。DOM・Canvas には依存しない。
//
// joints: { top, chin, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR,
//           hip, kneeL, kneeR, ankleL, ankleR, heelL, heelR } 各 {x, y}(px、下が+y)
// top=頭頂 / chin=あご / hip=股 / heelL,heelR=かかと(足裏の位置=全身の高さの基準。
// 左右で高さが違うポーズ画像では低い方=接地している足を基準にする)。旧形式の sole(足裏1点)も受け付ける

const REQUIRED_JOINTS = [
  'top', 'chin', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'wristL', 'wristR', 'hip', 'kneeL', 'kneeR', 'ankleL', 'ankleR',
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// baseRatios: 画像から測れない部位(手・足の長さ)の補完に使うベース比率
export function ratiosFromJoints(joints, baseRatios) {
  for (const key of REQUIRED_JOINTS) {
    const p = joints?.[key];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error(`関節「${key}」の位置が不正です`);
    }
  }
  // 足裏の位置: かかと(左右)の低い方。旧形式は sole
  const heels = [joints.heelL, joints.heelR].filter((p) => p && Number.isFinite(p.y));
  const soleY = heels.length > 0 ? Math.max(...heels.map((p) => p.y)) : joints.sole?.y;
  if (!Number.isFinite(soleY)) {
    throw new Error('関節「かかと」の位置が不正です');
  }
  const total = soleY - joints.top.y;
  if (total <= 10) {
    throw new Error('頭頂とかかとの間隔が近すぎます。骨格を画像の全身に合わせてください');
  }
  if (!(joints.top.y < joints.chin.y && joints.chin.y < joints.hip.y && joints.hip.y < soleY)) {
    throw new Error('頭頂→あご→股→かかとが上から順になるように配置してください');
  }

  const avg = (a, b) => (a + b) / 2;
  // 股関節(骨盤の左右)。旧形式(hipL/hipR なし)は股=hip を両脚の付け根として扱う
  const hipL = joints.hipL ?? joints.hip;
  const hipR = joints.hipR ?? joints.hip;
  const r = {
    head: (joints.chin.y - joints.top.y) / total,
    hipTop: (joints.hip.y - joints.top.y) / total,
    shoulderWidth: Math.abs(joints.shoulderR.x - joints.shoulderL.x) / total,
    // 腕・脚は傾き(ポーズ)を拾えるよう2点間距離で測る
    upperArm: avg(dist(joints.shoulderL, joints.elbowL), dist(joints.shoulderR, joints.elbowR)) / total,
    forearm: avg(dist(joints.elbowL, joints.wristL), dist(joints.elbowR, joints.wristR)) / total,
    thigh: avg(dist(hipL, joints.kneeL), dist(hipR, joints.kneeR)) / total,
    shin: avg(dist(joints.kneeL, joints.ankleL), dist(joints.kneeR, joints.ankleR)) / total,
    ankle: Math.max(0.01, (soleY - avg(joints.ankleL.y, joints.ankleR.y)) / total),
    // 手・足の長さは正面画像から測れないためベース体型から補完
    hand: baseRatios.hand,
    footLength: baseRatios.footLength,
  };

  // 芯材モデルは「腰〜足先 = 股下」を前提とするため、脚をバランス維持のまま股下に正規化
  const legSum = r.thigh + r.shin + r.ankle;
  const inseam = 1 - r.hipTop;
  if (legSum <= 0 || inseam <= 0.05) {
    throw new Error('脚の長さが測れません。股・ヒザ・くるぶしの位置を確認してください');
  }
  r.thigh = (r.thigh / legSum) * inseam;
  r.shin = (r.shin / legSum) * inseam;
  r.ankle = (r.ankle / legSum) * inseam;
  return r;
}
