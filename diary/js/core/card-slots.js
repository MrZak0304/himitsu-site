// 「きょうの1枚カード」の日記内保存の枠(v1.05・SPEC §10)。ピュア関数。
// 2026-10-10 PD 決定: 保存できるカードは 1日1枚が基本。広告つき版はリワード広告を1回見るごとに
// その日の枠が1枚増える(entry.cardSlotsEarned)。買い切り版・web は無制限。
// タグ枠(tag-slots.js)と同じ形の情報オブジェクトを返す。

export const CARD_BASE_SLOTS = 1;
export const NO_CARD_SLOT_MESSAGE = 'この日のカードは1枚まで保存できます。広告を見るともう1枚作れます(買い切り版は無制限)。';

export function cardSlotInfo(entry, variant) {
  const saved = Array.isArray(entry?.cards) ? entry.cards.length : 0;
  const earned = Number.isInteger(entry?.cardSlotsEarned) && entry.cardSlotsEarned > 0 ? entry.cardSlotsEarned : 0;
  if (variant !== 'free') {
    return { limit: Infinity, remaining: Infinity, saved, canAdd: true, reason: null };
  }
  const limit = CARD_BASE_SLOTS + earned;
  const remaining = Math.max(0, limit - saved);
  return { limit, remaining, saved, canAdd: remaining > 0, reason: remaining > 0 ? null : NO_CARD_SLOT_MESSAGE };
}

// 広告つき版向けの枠状況の表示文。無制限(買い切り版・web)は null
export function cardSlotStatusText(info) {
  if (!Number.isFinite(info?.remaining)) return null;
  if (info.remaining <= 0) return 'この日のカードは保存ずみです。広告を見るともう1枚作れます。';
  return `この日はあと${info.remaining}枚保存できます。`;
}
