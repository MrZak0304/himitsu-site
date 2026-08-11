// 無料版タグ枠の計算(SPEC §6)。基本枠10件+リワードで earned が増える(恒久・上限なし)。
// 枠の対象は「ユーザーが新規登録したタグ」のみ(定番タグは数えない)。web/paid は無制限。

export const NO_SLOT_MESSAGE = 'タグの登録枠がいっぱいです。広告を見ると枠を1つ増やせます(有料版は無制限)。';

export function tagSlotInfo(tagSlots, variant, userTagCount) {
  const base = Number.isInteger(tagSlots?.base) ? tagSlots.base : 10;
  const earned = Number.isInteger(tagSlots?.earned) && tagSlots.earned > 0 ? tagSlots.earned : 0;
  if (variant !== 'free') {
    return { limit: Infinity, remaining: Infinity, canAdd: true, reason: null };
  }
  const limit = base + earned;
  const remaining = Math.max(0, limit - userTagCount);
  return {
    limit,
    remaining,
    canAdd: remaining > 0,
    reason: remaining > 0 ? null : NO_SLOT_MESSAGE,
  };
}

// 無料版の枠状況を常時見せる表示文(2026-08-11 PD FB: 枠上限時の導線を分かりやすく)。
// paid/web(無制限)は null。いっぱいなら案内、残ありなら残数を返す。
export function slotStatusText(info) {
  if (!Number.isFinite(info?.remaining)) return null; // 無制限
  if (info.remaining <= 0) return 'タグの登録枠がいっぱいです。広告を見ると1つ増やせます。';
  return `自分のタグはあと${info.remaining}個ふやせます。`;
}
