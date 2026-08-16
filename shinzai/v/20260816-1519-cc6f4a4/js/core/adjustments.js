// js/core/adjustments.js — 体型調整(マイ体型)のピュアロジック
// ベース比率を調整し、整合(脚の合計=股下)を保ったまま新しい比率セットを返す。
// 有料版のみの機能(無料版は調整UIを出さない → js/build-flags.js)。
//
// 「頭身」は倍率でなく絶対値(2〜8頭身)で指定する(2026-08-14 PDフィードバック)。
// null のときはプリセットの頭身のまま。

export const ADJUSTMENT_DEFS = [
  { key: 'heads', label: '頭身', min: 2, max: 8, step: 0.1, absolute: true, default: null },
  { key: 'torso', label: '胴の長さ', min: 0.85, max: 1.15, step: 0.01, default: 1 },
  { key: 'shoulder', label: '肩幅', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  { key: 'arm', label: '腕の長さ', min: 0.8, max: 1.25, step: 0.01, default: 1 },
  { key: 'foot', label: '手足の大きさ', min: 0.7, max: 1.4, step: 0.01, default: 1 },
];

export const DEFAULT_ADJUSTMENTS = Object.fromEntries(
  ADJUSTMENT_DEFS.map((d) => [d.key, d.default]),
);

// 調整が既定から動いているか(保存データ・カスタム比率の要否判定に使う)
export function isAdjusted(adj) {
  return ADJUSTMENT_DEFS.some((d) => {
    const v = adj?.[d.key];
    if (d.default == null) return typeof v === 'number' && Number.isFinite(v);
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v - d.default) > 1e-6;
  }) || Number.isFinite(adj?.head); // 旧形式(頭の大きさ倍率)
}

function clampAdj(adj) {
  const out = { ...DEFAULT_ADJUSTMENTS };
  for (const def of ADJUSTMENT_DEFS) {
    const v = adj?.[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[def.key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  return out;
}

// base: proportions.js の ratios、adj: {heads, torso, shoulder, arm, foot}
// 旧形式の {head: 倍率} も読み込み互換のため受け付ける(v1初期の保存データ)。
export function applyAdjustments(base, adj = {}) {
  const a = clampAdj(adj);
  const r = { ...base };
  if (a.heads != null) {
    r.head = 1 / a.heads; // 頭身の絶対値指定
  } else if (typeof adj?.head === 'number' && Number.isFinite(adj.head)) {
    r.head = base.head * Math.min(1.6, Math.max(0.7, adj.head)); // 旧形式
  }
  r.hipTop = base.hipTop * a.torso;
  // 首(あご下〜股)が消えないよう頭高を胴内に収める
  if (r.head >= r.hipTop * 0.95) r.head = r.hipTop * 0.95;
  r.shoulderWidth = base.shoulderWidth * a.shoulder;
  r.upperArm = base.upperArm * a.arm;
  r.forearm = base.forearm * a.arm;
  r.hand = base.hand * a.foot;
  r.footLength = base.footLength * a.foot;
  // 脚は股下(1 − 頭頂〜股)を、ベースの脚内バランスのまま埋め直す(整合の維持)
  const legSum = base.thigh + base.shin + base.ankle;
  const inseam = 1 - r.hipTop;
  r.thigh = (base.thigh / legSum) * inseam;
  r.shin = (base.shin / legSum) * inseam;
  r.ankle = (base.ankle / legSum) * inseam;
  return r;
}
