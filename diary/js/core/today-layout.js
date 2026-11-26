// きょう画面の項目の並び(2026-10-28 PD「設定画面で各項目の順番をいじれるように」)。
// 設定の todayOrder(項目 ID の配列)を正しい形にそろえ、上へ/下へ動かす。UI 非依存のピュア関数。

// 既定の並び=2026-10-28 の開発リードの家族の FB の並び。予定を日課の上に(2026-10-28 22:17 PD「デフォルトはそれでいい」)
export const TODAY_BLOCKS = Object.freeze(['plans', 'habits', 'frequent', 'tags', 'text', 'folders', 'photos', 'card']);

// 知らない項目・重複を捨て、足りない項目は既定の並びでの直前の項目のうしろに補う(項目が増えても壊れない)
export function normalizeTodayOrder(raw) {
  const order = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (TODAY_BLOCKS.includes(id) && !order.includes(id)) order.push(id);
  }
  TODAY_BLOCKS.forEach((id, i) => {
    if (order.includes(id)) return;
    const prev = TODAY_BLOCKS.slice(0, i).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  });
  return order;
}

// dir: -1=上へ / 1=下へ。端では動かさない(同じ並びを返す)
export function moveTodayBlock(order, id, dir) {
  const list = normalizeTodayOrder(order);
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

export function isDefaultTodayOrder(order) {
  const list = normalizeTodayOrder(order);
  return list.every((id, i) => id === TODAY_BLOCKS[i]);
}

// ドラッグ&ドロップ用(2026-10-28 PD「指でドラッグ&ドロップで操作できるように」): id を toIndex の位置へ動かす(範囲外は端へ)
export function moveTodayBlockTo(order, id, toIndex) {
  const list = normalizeTodayOrder(order);
  const i = list.indexOf(id);
  if (i < 0) return list;
  list.splice(i, 1);
  const j = Math.max(0, Math.min(list.length, Number.isInteger(toIndex) ? toIndex : i));
  list.splice(j, 0, id);
  return list;
}
