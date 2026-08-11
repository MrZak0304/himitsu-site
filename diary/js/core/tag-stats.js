// タグ集計(ピュア)。頻出タグ(直近N日)と月間ランキングを求める(U5/KTD5)。
// hidden タグは候補・集計から除く。UIは「きょう」の頻出とふりかえりのランキングで使う。

import { isValidKey, monthOfKey } from './dates.js';

// 日付キー(YYYY-MM-DD)を数値へ(比較用)。不正は -Infinity。
function keyNum(key) {
  return isValidKey(key) ? Number(key.replaceAll('-', '')) : -Infinity;
}

// 直近 days 日(todayKey を含む)で使用回数の多いタグ上位 limit 件のIDを返す。
// hiddenTagIds に含まれるタグは除外。同数は最近使った順(最新使用日が新しい方)を優先。
export function frequentTagIds(entriesMap, todayKey, { days = 30, limit = 6, hiddenTagIds = new Set() } = {}) {
  if (!isValidKey(todayKey)) return [];
  const end = keyNum(todayKey);
  // 開始日 = todayKey の days-1 日前
  const [y, m, d] = todayKey.split('-').map(Number);
  const startDate = new Date(y, m - 1, d - (days - 1));
  const start = startDate.getFullYear() * 10000 + (startDate.getMonth() + 1) * 100 + startDate.getDate();

  const count = new Map();
  const lastUsed = new Map();
  for (const [date, entry] of Object.entries(entriesMap ?? {})) {
    const n = keyNum(date);
    if (n < start || n > end) continue;
    for (const id of entry?.tags ?? []) {
      if (hiddenTagIds.has(id)) continue;
      count.set(id, (count.get(id) ?? 0) + 1);
      if (n > (lastUsed.get(id) ?? -Infinity)) lastUsed.set(id, n);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (lastUsed.get(b[0]) ?? 0) - (lastUsed.get(a[0]) ?? 0))
    .slice(0, limit)
    .map(([id]) => id);
}

// 指定月(year, month)のタグ使用回数ランキング。hidden は除外。
// 戻り値: [{ id, count }](多い順、同数はID安定順)。limit で件数制限(0=全件)。
export function monthlyTagRanking(entriesMap, year, month, { hiddenTagIds = new Set(), limit = 0 } = {}) {
  const count = new Map();
  for (const [date, entry] of Object.entries(entriesMap ?? {})) {
    if (!isValidKey(date)) continue;
    const mo = monthOfKey(date);
    if (mo.year !== year || mo.month !== month) continue;
    for (const id of entry?.tags ?? []) {
      if (hiddenTagIds.has(id)) continue;
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  const ranked = [...count.entries()]
    .map(([id, c]) => ({ id, count: c }))
    .sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return limit > 0 ? ranked.slice(0, limit) : ranked;
}
