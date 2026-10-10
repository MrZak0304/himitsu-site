// タグ用スタンプの設定(v1.05・SPEC §10「タグ用スタンプの自作」)。ピュア関数。
// tag.stamp: null(既定=テーマ色のハンコ風)
//          | { type:'builtin', color, alpha, shape }  … 内蔵スタンプ(色・透過度・形)
//          | { type:'image', imageId }                 … 自作画像(画像ストアに kind:'stamp' で保存)
// 反映先はカードだけ(2026-10-10 PD 決定。きょう画面・カレンダーのチップは変えない)。

// 定番色 8 色+テーマ色('theme')+透明('transparent'=背景なし・文字だけ)
export const STAMP_COLORS = Object.freeze([
  { id: 'theme', name: 'テーマ色', hex: null },
  { id: 'red', name: 'あか', hex: '#d9534f' },
  { id: 'orange', name: 'だいだい', hex: '#e2873a' },
  { id: 'yellow', name: 'きいろ', hex: '#d4b429' },
  { id: 'green', name: 'みどり', hex: '#4e9a5a' },
  { id: 'blue', name: 'あお', hex: '#4a7dbd' },
  { id: 'purple', name: 'むらさき', hex: '#8a6fc8' },
  { id: 'pink', name: 'ピンク', hex: '#e37b95' },
  { id: 'gray', name: 'グレー', hex: '#7d7d85' },
  { id: 'transparent', name: '透明', hex: null },
]);

export const STAMP_SHAPES = Object.freeze([
  { id: 'round', name: '角丸' },
  { id: 'circle', name: 'まる' },
  { id: 'ribbon', name: 'リボン' },
  { id: 'zigzag', name: 'ギザギザ' },
]);

export const STAMP_ALPHA_MIN = 0.2;
export const STAMP_ALPHA_MAX = 1;
export const DEFAULT_BUILTIN_STAMP = Object.freeze({ type: 'builtin', color: 'theme', alpha: 1, shape: 'round' });

const COLOR_IDS = new Set(STAMP_COLORS.map((c) => c.id));
const SHAPE_IDS = new Set(STAMP_SHAPES.map((s) => s.id));

export function clampAlpha(v) {
  if (!Number.isFinite(v)) return STAMP_ALPHA_MAX;
  return Math.min(STAMP_ALPHA_MAX, Math.max(STAMP_ALPHA_MIN, Math.round(v * 100) / 100));
}

// 保存前・読み出し時の正規化。不正な値は既定(null=既定スタンプ)に落とし、落ちない。
export function normalizeStamp(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (raw.type === 'image') {
    return typeof raw.imageId === 'string' && raw.imageId !== '' ? { type: 'image', imageId: raw.imageId } : null;
  }
  if (raw.type === 'builtin') {
    return {
      type: 'builtin',
      color: COLOR_IDS.has(raw.color) ? raw.color : DEFAULT_BUILTIN_STAMP.color,
      alpha: clampAlpha(raw.alpha),
      shape: SHAPE_IDS.has(raw.shape) ? raw.shape : DEFAULT_BUILTIN_STAMP.shape,
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
