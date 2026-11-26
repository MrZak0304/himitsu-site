// 広告なしのお試し期間(adMode='off'・v1.14)の「+1」ボタンの 1 日 1 回の判定。ピュア関数。
// 2026-10-28 PD 決定: AdMob の一時停止の間は広告の代わりに「+1」を出すが、付け放題にはしない(1 日 1 回)。
// タグ枠(tagSlots.earned・恒久)とカード(その日の cardSlotsEarned)は別々に数える。
// 最後に使った日(YYYY-MM-DD・ローカル日付)を設定の adFreeGrants に持つ。「今日」は引数で受け取る。

import { tr } from '../i18n/index.js';
import { isValidKey } from './dates.js';

export const GRANT_KINDS = Object.freeze(['tag', 'card']);
export const AD_FREE_USED_MESSAGE = tr('あしたまた増やせます。');

// 設定の adFreeGrants を正規化する(知らない値・壊れた値は「まだ使っていない」=null)
export function normalizeAdFreeGrants(raw) {
  const src = typeof raw === 'object' && raw !== null ? raw : {};
  const out = {};
  for (const kind of GRANT_KINDS) out[kind] = isValidKey(src[kind]) ? src[kind] : null;
  return out;
}

// 最後に使った日が今日でなければ押せる
export function canGrant(lastDay, today) {
  return lastDay !== today;
}

// kind を今日使ったことにした新しい adFreeGrants を返す(元は変えない)
export function markGranted(grants, kind, today) {
  if (!GRANT_KINDS.includes(kind)) throw new Error(`unknown grant kind: ${kind}`);
  return { ...normalizeAdFreeGrants(grants), [kind]: today };
}
