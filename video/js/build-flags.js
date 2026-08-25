// ビルドフラグ(Web版の既定値)。
// このファイルはコミットされたまま Web(デモ)配信で使われる。
// モバイルアプリのビルド時は scripts/build-dist.mjs が dist/js/build-flags.js を
// variant(free=無料広告版 / paid=買い切り広告なし版)に応じて生成し上書きする。
//
// 機能の出し分け(SPEC §7 の表):
//   web  … 全機能(有料版相当。デモ・開発用)
//   free … 作成のみ(復元なし)・自由形状なし・1分制限・広告あり
//   paid … 全機能(作成/復元/書き出し/自由形状)・無制限・広告なし(1,000円)
export const BUILD = {
  variant: 'web', // 'web' | 'free' | 'paid'
  ads: false,
  adMode: 'test', // 'test' | 'prod'。'prod' は本番広告(明示指定したビルドのみ)
};

/** この variant が「有料相当のフル機能」か(web/paid) */
export function isFullVersion() {
  return BUILD.variant !== 'free';
}

/** 機能フラグ(variantから導出。UIの出し分けはこれを見る) */
export const FEATURES = {
  restore: isFullVersion(),      // 復元タブ
  freeForm: isFullVersion(),     // 自由形状(なげなわ)
  splitFormat: isFullVersion(),  // 分割型(A形式)の選択。無料版は一体型固定
  maxCreateSeconds: isFullVersion() ? Infinity : 60, // 無料版は作成1分まで
};

/** 表示用のバージョン名 */
export function buildLabel() {
  return { web: 'Web版', free: '無料版(広告つき)', paid: '有料版' }[BUILD.variant] ?? BUILD.variant;
}
