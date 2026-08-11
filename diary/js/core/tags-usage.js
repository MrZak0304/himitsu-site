// タグの使用状況(ピュア)。あるタグが過去の記録のどの日で使われているかを集計する。
// タグ削除C案(U4)の「〇日で使用中→使用日へ移動」の判定に使う。

// entriesMap: {日付キー: {tags:[...] , ...}} 形。tagId: 対象タグID。
// 戻り値: { dates: [日付キー(昇順)], count }
export function tagUsage(entriesMap, tagId) {
  const dates = [];
  for (const [date, entry] of Object.entries(entriesMap ?? {})) {
    if (Array.isArray(entry?.tags) && entry.tags.includes(tagId)) dates.push(date);
  }
  dates.sort();
  return { dates, count: dates.length };
}

// 全記録から指定タグIDを取り除いた新しい map を返す(完全削除用。ピュア=元を変更しない)。
// 変更があった日付キーの配列も返す(呼び出し側が保存範囲を把握できるように)。
export function removeTagFromEntries(entriesMap, tagId) {
  const next = {};
  const changed = [];
  for (const [date, entry] of Object.entries(entriesMap ?? {})) {
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    if (tags.includes(tagId)) {
      next[date] = { ...entry, tags: tags.filter((id) => id !== tagId) };
      changed.push(date);
    } else {
      next[date] = entry;
    }
  }
  return { entries: next, changed };
}
