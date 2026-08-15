// js/core/armature.js — 芯材(アルミ線)の寸法計算(UI非依存・ピュア関数)
//
// 用語:
//   仕上がり寸法 … 完成した骨格で線がたどる経路の長さ(曲げ・ループ込み)
//   切り出し寸法 … ねじり(2本撚り)による縮み・接合ののりしろを見込んだ、
//                   実際に切るべき線の長さ。必ず仕上がりより長い。
// この2つを混同するとユーザーが線を短く切ってしまい作り直しになるため、
// 出力では常に区別する(CLAUDE.md 不変条件)。

import { PROPORTION_PRESETS, validateRatios } from './proportions.js';

// 完成サイズ(全高cm)ごとの推奨アルミ線径の目安
export const WIRE_DIAMETER_TABLE = [
  { maxFigureCm: 10, mm: 1.0 },
  { maxFigureCm: 15, mm: 1.5 },
  { maxFigureCm: 22, mm: 2.0 },
  { maxFigureCm: 30, mm: 2.5 },
  { maxFigureCm: Infinity, mm: 3.0 },
];

export const DEFAULT_OPTIONS = {
  strands: 2, // ねじり本数(2=2本撚り。参考画像と同じ)
  twistFactor: 1.1, // ねじりで縮む分の割増(経験則の目安)
  joinMarginCm: 2, // 他パーツとの接合1か所あたりののりしろ
};

// よく使うフィギュアスケールの選択肢(UI用)
export const SCALE_CHOICES = [12, 10, 8, 7, 6, 5, 4];

function round1(v) {
  return Math.round(v * 10) / 10;
}

export function recommendedWireDiameter(figureHeightCm) {
  for (const row of WIRE_DIAMETER_TABLE) {
    if (figureHeightCm <= row.maxFigureCm) return row.mm;
  }
  return WIRE_DIAMETER_TABLE[WIRE_DIAMETER_TABLE.length - 1].mm;
}

// 芯材計算の本体。
//   modelHeightCm    … 元の人物(キャラクター)の身長 cm
//   preset           … PROPORTION_PRESETS のキー(customRatios 指定時は無視)
//   customRatios     … 比率セットを直接指定(手動調整・人外対応の入口)
//   scaleDenominator … スケール分母(例: 8 → 1/8)
//   targetHeightCm   … 完成サイズを直接指定(scaleDenominator とどちらか必須)
//   options          … DEFAULT_OPTIONS の上書き
export function computeArmature({
  modelHeightCm,
  preset = 'female-adult',
  customRatios = null,
  scaleDenominator = null,
  targetHeightCm = null,
  options = {},
} = {}) {
  if (!Number.isFinite(modelHeightCm) || modelHeightCm <= 0) {
    throw new Error('身長(modelHeightCm)は正の数で指定してください');
  }
  if (targetHeightCm == null && scaleDenominator == null) {
    throw new Error('スケール(scaleDenominator)か完成サイズ(targetHeightCm)のどちらかを指定してください');
  }
  if (scaleDenominator != null && (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0)) {
    throw new Error('スケール分母は正の数で指定してください');
  }
  if (targetHeightCm != null && (!Number.isFinite(targetHeightCm) || targetHeightCm <= 0)) {
    throw new Error('完成サイズ(targetHeightCm)は正の数で指定してください');
  }

  const ratios = customRatios ?? PROPORTION_PRESETS[preset]?.ratios;
  if (!ratios) throw new Error(`未知のプリセットです: ${preset}`);
  const warnings = validateRatios(ratios);
  if (warnings.some((w) => w.includes('不正'))) {
    throw new Error(warnings.join(' / '));
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const figureHeightCm = targetHeightCm ?? modelHeightCm / scaleDenominator;
  const scaleValue = modelHeightCm / figureHeightCm;
  const scaleLabel = scaleDenominator != null
    ? `1/${scaleDenominator}`
    : `約1/${round1(scaleValue)}`;

  // 完成サイズでの各部位の寸法(cm)
  const s = {};
  for (const [key, ratio] of Object.entries(ratios)) {
    s[key] = ratio * figureHeightCm;
  }
  const segments = {
    figureHeight: round1(figureHeightCm),
    head: round1(s.head),
    headTopToHip: round1(s.hipTop), // 頭頂〜腰(股)
    hipToSole: round1(figureHeightCm - s.hipTop), // 腰(股)〜足裏
    shoulderWidth: round1(s.shoulderWidth),
    upperArm: round1(s.upperArm),
    forearm: round1(s.forearm),
    hand: round1(s.hand),
    armTotal: round1(s.upperArm + s.forearm + s.hand), // 肩〜指先
    thigh: round1(s.thigh),
    shin: round1(s.shin),
    ankle: round1(s.ankle),
    footLength: round1(s.footLength),
  };

  // 頭・手・足はアルミ芯で作らない前提(パテ等で造形。2026-08-15 PDフィードバック)。
  // 芯は 背骨(首〜股)+腕(手首まで)+脚(足首の先まで)の3系統。
  // 首の先・足先はパテを保持できるよう少し伸ばす(同第7弾FB)。
  const spineLen = s.hipTop - s.head; // あご下(首)〜股
  const neckStub = s.head / 3; // 首の先: 頭の中への差し込み
  const footStub = s.ankle + s.footLength * 0.2; // 足先: くるぶし〜足裏+つま先側へ少し
  const handStub = s.hand * 0.4; // 手首の先: 手(パテ)への接続しろ
  const legInsert = spineLen / 2; // 脚線を胴に固定する差し込み分

  const cut = (finishedCm, joins) =>
    round1(finishedCm * opts.strands * opts.twistFactor + opts.joinMarginCm * joins);

  const cutList = [
    {
      id: 'trunk',
      name: '体幹線(首の先〜股)',
      finishedCm: round1(neckStub + spineLen),
      cutCm: cut(neckStub + spineLen, 1),
      count: 1,
      note: '首(あご下)〜股+頭への差し込み(頭高の1/3)。頭はパテ等で造形。股で脚線と接合',
    },
    {
      id: 'arms',
      name: '腕線(手首の先〜肩〜手首の先)',
      finishedCm: round1(s.shoulderWidth + 2 * (s.upperArm + s.forearm + handStub)),
      cutCm: cut(s.shoulderWidth + 2 * (s.upperArm + s.forearm + handStub), 1),
      count: 1,
      note: '1本で左右の腕を作り、肩の位置で背骨に接合。手首の先(手への接続しろ=手長の4割)まで伸ばし、手本体はパテ造形',
    },
    {
      id: 'leg',
      name: '脚線(股〜足首の先)',
      finishedCm: round1(legInsert + s.thigh + s.shin + footStub),
      cutCm: cut(legInsert + s.thigh + s.shin + footStub, 1),
      count: 2,
      note: '左右で2本。上端は胴の中ほどまで差し込んで接合。足首の先(足裏+つま先側)まで少し伸ばし、足本体はパテ造形',
    },
  ];

  const totalCutCm = round1(cutList.reduce((sum, p) => sum + p.cutCm * p.count, 0));

  return {
    scaleLabel,
    scaleValue: round1(scaleValue),
    figureHeightCm: round1(figureHeightCm),
    wireDiameterMm: recommendedWireDiameter(figureHeightCm),
    segments,
    cutList,
    totalCutCm,
    options: opts,
    warnings,
  };
}
