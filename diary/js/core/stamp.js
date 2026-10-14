// タグ用スタンプの設定(v1.05・SPEC §10「タグ用スタンプの自作」)。ピュア関数。
// tag.stamp: null(既定=テーマ色のハンコ風)
//          | { type:'builtin', color, alpha, shape, rotate, orient }  … 内蔵スタンプ(色・透過度・形・回転・文字の向き)
//          | { type:'image', imageId, rotate }                 … 自作画像(画像ストアに kind:'stamp' で保存)
// rotate(度・-180〜180)はスタンプ自体の傾き(2026-10-12 PD FB)。カードのシールの回転(配置)に足して描く。
// 反映先はカードだけ(2026-10-10 PD 決定。きょう画面・カレンダーのチップは変えない)。

import { tr } from '../i18n/index.js';

// 定番色 8 色+テーマ色('theme')+透明('transparent'=背景なし・文字だけ)
export const STAMP_COLORS = Object.freeze([
  { id: 'theme', name: tr('テーマ色'), hex: null },
  { id: 'red', name: tr('あか'), hex: '#d9534f' },
  { id: 'orange', name: tr('だいだい'), hex: '#e2873a' },
  { id: 'yellow', name: tr('きいろ'), hex: '#d4b429' },
  { id: 'green', name: tr('みどり'), hex: '#4e9a5a' },
  { id: 'blue', name: tr('あお'), hex: '#4a7dbd' },
  { id: 'purple', name: tr('むらさき'), hex: '#8a6fc8' },
  { id: 'pink', name: tr('ピンク'), hex: '#e37b95' },
  { id: 'gray', name: tr('グレー'), hex: '#7d7d85' },
  { id: 'transparent', name: tr('透明'), hex: null },
]);

export const STAMP_SHAPES = Object.freeze([
  { id: 'round', name: tr('角丸') },
  { id: 'circle', name: tr('まる') },
  { id: 'ribbon', name: tr('リボン') },
  { id: 'zigzag', name: tr('ギザギザ') },
]);

// 文字の向き(内蔵スタンプだけ。カードに貼るときの最初の向きになる。2026-10-12 PD FB)
export const STAMP_ORIENTS = Object.freeze([
  { id: 'h', name: tr('ヨコ書き') },
  { id: 'v', name: tr('タテ書き') },
]);

export const STAMP_ALPHA_MIN = 0.2;
export const STAMP_ALPHA_MAX = 1;
export const STAMP_ROTATE_MIN = -180;
export const STAMP_ROTATE_MAX = 180;
export const STAMP_ROTATE_STEP = 5; // スライダー1目盛り(度)
// 既定は真っ直ぐ(rotate 0)。斜めにしたければ設定で回す(2026-10-12 PD FB「デフォルトで斜めにしない」)
export const DEFAULT_BUILTIN_STAMP = Object.freeze({ type: 'builtin', color: 'theme', alpha: 1, shape: 'round', rotate: 0, orient: 'h' });

const COLOR_IDS = new Set(STAMP_COLORS.map((c) => c.id));
const SHAPE_IDS = new Set(STAMP_SHAPES.map((s) => s.id));

export function clampAlpha(v) {
  if (!Number.isFinite(v)) return STAMP_ALPHA_MAX;
  return Math.min(STAMP_ALPHA_MAX, Math.max(STAMP_ALPHA_MIN, Math.round(v * 100) / 100));
}

// 回転(度)。整数に丸め、-180〜180 に収める(360 の周期で折り返す)。不正値は 0
export function clampRotate(v) {
  if (!Number.isFinite(v)) return 0;
  let d = Math.round(v) % 360;
  if (d > STAMP_ROTATE_MAX) d -= 360;
  if (d < STAMP_ROTATE_MIN) d += 360;
  return d === -0 ? 0 : d;
}

// スタンプ自体の傾き(度)。null(既定)や rotate 無し(1.05 下書き時の形)は 0
export function stampRotate(stamp) {
  return clampRotate(stamp?.rotate);
}

// 文字の向き。内蔵スタンプの 'v' だけ縦書き。既定・画像・欠落は 'h'
export function stampOrient(stamp) {
  return stamp?.type === 'builtin' && stamp.orient === 'v' ? 'v' : 'h';
}

// 保存前・読み出し時の正規化。不正な値は既定(null=既定スタンプ)に落とし、落ちない。
export function normalizeStamp(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (raw.type === 'image') {
    return typeof raw.imageId === 'string' && raw.imageId !== '' ? { type: 'image', imageId: raw.imageId, rotate: clampRotate(raw.rotate) } : null;
  }
  if (raw.type === 'builtin') {
    return {
      type: 'builtin',
      color: COLOR_IDS.has(raw.color) ? raw.color : DEFAULT_BUILTIN_STAMP.color,
      alpha: clampAlpha(raw.alpha),
      shape: SHAPE_IDS.has(raw.shape) ? raw.shape : DEFAULT_BUILTIN_STAMP.shape,
      rotate: clampRotate(raw.rotate),
      orient: raw.orient === 'v' ? 'v' : 'h',
    };
  }
  return null;
}

// 描画用の色の解決。theme は {accent} を持つテーマ色。
// 既定・テーマ色はインク=テーマ色。定番色はインク=その色。透明は背景(白いチップ)なし=インクだけ。
// 返り値: { ink: string, transparent: boolean, alpha }
export function resolveStampColors(stamp, theme) {
  const accent = theme?.accent ?? '#4a7dbd';
  if (!stamp || stamp.type !== 'builtin') return { ink: accent, transparent: false, alpha: 1 };
  if (stamp.color === 'transparent') return { ink: accent, transparent: true, alpha: stamp.alpha };
  const c = STAMP_COLORS.find((x) => x.id === stamp.color);
  return { ink: c?.hex ?? accent, transparent: false, alpha: stamp.alpha };
}

// 画像スタンプが参照する画像ID(バックアップ・削除時の参照確認用)
export function stampImageIds(tags) {
  const ids = [];
  for (const t of tags ?? []) if (t?.stamp?.type === 'image' && t.stamp.imageId) ids.push(t.stamp.imageId);
  return ids;
}
