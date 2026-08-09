// 画像添付の枚数制限と一押し画像のピュア判定(SPEC §2.1)。

export const MAX_IMAGES_PER_DAY = 10;
export const LIMIT_MESSAGE = '画像は1日10枚までです。';

// 現在の枚数と追加希望枚数から、受け入れ枚数を判定する
export function acceptImages(currentCount, addCount) {
  const room = Math.max(0, MAX_IMAGES_PER_DAY - currentCount);
  const accepted = Math.min(room, addCount);
  const rejected = addCount - accepted;
  return {
    accepted,
    rejected,
    reason: rejected > 0 ? LIMIT_MESSAGE : null,
  };
}

// pushIndex を正規化: 画像なし→null、範囲外・未選択→0(最初の1枚)
export function normalizePushIndex(images, pushIndex) {
  if (!images || images.length === 0) return null;
  if (Number.isInteger(pushIndex) && pushIndex >= 0 && pushIndex < images.length) return pushIndex;
  return 0;
}

// idx の画像を削除したあとの {images, pushIndex}。
// 一押しを削除した場合は先頭へ繰上げ。全削除で一押しなし(null)。
export function removeImageAt(images, pushIndex, idx) {
  const next = images.filter((_, i) => i !== idx);
  if (next.length === 0) return { images: next, pushIndex: null };
  let p = normalizePushIndex(images, pushIndex);
  if (p === idx) {
    p = 0;
  } else if (p > idx) {
    p -= 1;
  }
  return { images: next, pushIndex: normalizePushIndex(next, p) };
}
