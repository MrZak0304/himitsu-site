// js/core/proportions.js — 人体プロポーションのプリセット(UI非依存・ピュアデータ)
//
// 値はすべて「全高(身長)に対する比率」。参考画像(柚p氏ブログ引用の芯材スケッチ)の
// 目安則に合わせている:
//   ・頭頂〜腰(股) = 腰(股)〜足裏 = 全高の 1/2
//   ・もものつけ根〜ヒザ ≒ ヒザ〜くるぶし
//   ・腕はヒジが よこ腹(腰のあたり)にくる長さ
// 人外・デフォルメ体型はプリセットの追加で対応する(構造を変えない)。

export const PROPORTION_PRESETS = {
  'female-adult': {
    // 既定プリセット。需要の中心は少女キャラのため頭身を約6に下げた(2026-08-14 PDフィードバック)
    label: '女性(約6頭身)',
    ratios: {
      head: 0.167, // 頭高(頭頂〜あご)
      hipTop: 0.5, // 頭頂〜股(腰)
      shoulderWidth: 0.215, // 肩幅
      upperArm: 0.165, // 肩〜ヒジ
      forearm: 0.15, // ヒジ〜手首
      hand: 0.1, // 手首〜指先
      thigh: 0.24, // 股〜ヒザ
      shin: 0.21, // ヒザ〜くるぶし
      ankle: 0.05, // くるぶし〜足裏
      footLength: 0.14, // かかと〜つま先
    },
  },
  'male-adult': {
    label: '男性(成人・約7頭身)',
    ratios: {
      head: 0.143,
      hipTop: 0.5,
      shoulderWidth: 0.245,
      upperArm: 0.172,
      forearm: 0.155,
      hand: 0.108,
      thigh: 0.24,
      shin: 0.215,
      ankle: 0.045,
      footLength: 0.15,
    },
  },
  'chibi-3head': {
    label: 'デフォルメ(約3頭身)',
    ratios: {
      head: 0.333,
      hipTop: 0.62, // 頭が大きいぶん胴脚は短い
      shoulderWidth: 0.2,
      upperArm: 0.11,
      forearm: 0.1,
      hand: 0.07,
      thigh: 0.17,
      shin: 0.16,
      ankle: 0.05,
      footLength: 0.13,
    },
  },
};

// 比率セットの整合チェック。致命的な破綻(負値・脚の合計と股下の不一致)を検出する。
// 戻り値は警告メッセージの配列(空なら問題なし)。
export function validateRatios(ratios) {
  const warnings = [];
  const required = [
    'head', 'hipTop', 'shoulderWidth', 'upperArm', 'forearm', 'hand',
    'thigh', 'shin', 'ankle', 'footLength',
  ];
  for (const key of required) {
    const v = ratios?.[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= 1) {
      warnings.push(`比率 ${key} が不正です(0〜1の数値が必要)`);
    }
  }
  if (warnings.length > 0) return warnings;
  const legSum = ratios.thigh + ratios.shin + ratios.ankle;
  const inseam = 1 - ratios.hipTop; // 股下 = 全高 − (頭頂〜股)
  if (Math.abs(legSum - inseam) > 0.02) {
    warnings.push(
      `脚の合計(もも+すね+足首=${legSum.toFixed(3)})が股下(${inseam.toFixed(3)})と一致していません`,
    );
  }
  return warnings;
}
