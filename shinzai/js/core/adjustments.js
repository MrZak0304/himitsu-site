// js/core/adjustments.js — 体型調整(マイ体型)のピュアロジック
// ベース比率に倍率をかけ、整合(脚の合計=股下)を保ったまま新しい比率セットを返す。
// 有料版のみの機能(無料版は調整UIを出さない → js/build-flags.js)。

export const ADJUSTMENT_DEFS = [
  { key: 'head', label: '頭の大きさ', min: 0.7, max: 1.6 },
  { key: 'torso', label: '胴の長さ', min: 0.85, max: 1.15 },
  { key: 'shoulder', label: '肩幅', min: 0.7, max: 1.4 },
  { key: 'arm', label: '腕の長さ', min: 0.8, max: 1.25 },
  { key: 'foot', label: '手足の大きさ', min: 0.7, max: 1.4 },
];

export const DEFAULT_ADJUSTMENTS = Object.fromEntries(
  ADJUSTMENT_DEFS.map((d) => [d.key, 1]),
);

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

// base: proportions.js の ratios、adj: {head, torso, shoulder, arm, foot} の倍率
export function applyAdjustments(base, adj = {}) {
  const a = clampAdj(adj);
  const r = { ...base };
  r.head = base.head * a.head;
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
