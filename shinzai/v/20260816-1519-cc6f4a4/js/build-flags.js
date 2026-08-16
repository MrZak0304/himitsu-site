// js/build-flags.js — web / free / paid の切り替え(姉妹アプリと同方式)
// Web版デモの既定は有料版相当。開発用フックとして ?variant=free|paid で切替できる。
// モバイル化時は scripts/build-dist.mjs がこのファイルの VARIANT を書き換える想定。

const query = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('variant')
  : null;

export const VARIANT = query === 'free' ? 'free' : query === 'paid' ? 'paid' : 'web';
export const IS_FREE = VARIANT === 'free';

// 無料版の制限(2026-08-13 PD決定): 体型プリセットは女性・男性のみ、
// 体型調整(マイ体型)は不可、保存は2件まで。スケールは制限しない。
export const LIMITS = IS_FREE
  ? { presetKeys: ['female-adult', 'male-adult'], adjustments: false, saveLimit: 2 }
  : { presetKeys: null, adjustments: true, saveLimit: Infinity };

export const VARIANT_LABEL = {
  web: 'Web版デモ(有料版相当)',
  free: '無料版(広告つき)相当',
  paid: '有料版相当',
}[VARIANT];
